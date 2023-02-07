'use strict';
const WebSocket = require('ws');
const MethodContext = require('./method-context');
const StreamReceiver = require('../common/stream-receiver');
const createIncrementor = require('../common/create-incrementor');
const parseMessage = require('../common/parse-message');
const Heartbeat = require('../common/heartbeat');
const Encoder = require('../common/encoder');
const Stream = require('../common/stream');
const M = require('../common/message');

// TODO: after encoding a stream to send
//   on data/end/error, send Stream Chunk
//   upon receiving Stream Cancel, destroy the stream
//   DO NOT store this in the set of "open Stream IDs"
// TODO: destroy/abort sent streams when connection closes

// TODO: limit octet stream chunks to be 256 KiB in size, at most
// TODO: maybe buffer/group octet stream chunks to be at least 64 KiB, if waiting anyways
// TODO: when sending a stream, pause/resume based on ws.bufferedAmount (not just Stream Signals)

// TODO: note that msgpack decode AND encode can both throw
// TODO: make sure we are not allowing ourselves to encode streams in streams

module.exports = (methods, logger) => {
	const getSocketId = createIncrementor();

	return (socket) => {
		const socketId = getSocketId();
		const heartbeat = new Heartbeat(onHeartbeat);
		const encoder = new Encoder();
		const requests = new Map();
		const notifications = new Set();
		const receivedStreams = new Map();

		function onHeartbeat(isAlive) {
			if (isAlive) {
				socket.ping();
			} else {
				logger('Socket[%s] heartbeat failure', socketId);
				socket.close(1001, 'Connection timed out');
				socket.terminate();
			}
		}

		function invokeMethod(ctx, methodName, param, streams, cb) {
			logger('Socket[%s] method "%s" invoked', socketId, methodName);
			receiveStreams(streams);
			const method = methods.get(methodName) || methodNotFound;
			new Promise(resolve => resolve(method(param, ctx)))
				.then((result) => {
					logger('Socket[%s] method "%s" succeeded', socketId, methodName);
					if (!ctx.isNotification && !ctx.isAborted) {
						// TODO: encode() could return streams
						socket.send(encoder.encode([M.RESPONSE_SUCCESS, ctx.requestId, result]));
					}
				}, (err) => {
					logger('Socket[%s] method "%s" failed: %s', socketId, methodName, err);
					if (!ctx.isNotification && !ctx.isAborted) {
						err = err instanceof Error && err.expose ? err : new Error(err.message);
						// TODO: encode() could return streams
						socket.send(encoder.encode([M.RESPONSE_FAILURE, ctx.requestId, err]));
					}
				})
				.catch((err) => {
					logger('Socket[%s] error: %s', socketId, err);
					socket.close(1011, 'Server error');
				})
				.finally(() => {
					discardStreams(streams);
					cb();
				});
		}

		function receiveStreams(streams) {
			for (const [streamId, stream] of streams) {
				const receiver = new StreamReceiver(stream, encoder, {
					onCancellation: (err) => {
						if (receivedStreams.delete(streamId)) {
							socket.send(encoder.encodeInert([M.STREAM_CANCELLATION, streamId]));
						}
						if (err) {
							logger('Socket[%s] %s', socketId, err.message);
							socket.close(err.code, err.reason);
						}
					},
					onSignal: (received, available) => {
						if (receivedStreams.has(streamId)) {
							received = Math.floor(received / 1024);
							available = Math.floor(available / 1024);
							socket.send(encoder.encodeInert([M.STREAM_SIGNAL, streamId, received, available]));
						}
					},
				});
				receivedStreams.set(streamId, receiver);
			}
		}

		function discardStreams(streams, forceCancel = false) {
			for (const [streamId, stream] of streams) {
				if (!Stream.isLocked(stream)) {
					Stream.cancel(stream);
					if (receivedStreams.delete(streamId) || forceCancel) {
						socket.send(encoder.encodeInert([M.STREAM_CANCELLATION, streamId]));
					}
				}
			}
		}

		socket
			.on('close', () => {
				logger('Socket[%s] closed', socketId);
				for (const abortController of requests.values()) {
					abortController.abort();
				}
				for (const abortController of notifications.values()) {
					abortController.abort();
				}
				for (const receiver of receivedStreams.values()) {
					receiver.error(new Error('Scratch-RPC: WebSocket disconnected'));
				}
				requests.clear();
				notifications.clear();
				receivedStreams.clear();
				heartbeat.stop();
			})
			.on('error', (err) => {
				logger('Socket[%s] error: %s', socketId, err);
			})
			.on('ping', () => {
				heartbeat.reset();
			})
			.on('pong', () => {
				heartbeat.reset();
			})
			.on('message', (rawMsg) => {
				heartbeat.reset();

				let msgType, msg, streams;
				try {
					[msgType, msg, streams] = parseMessage(
						rawMsg, encoder, handlers, receivedStreams, requests
					);
				} catch (err) {
					logger('Socket[%s] %s', socketId, err.message);
					socket.close(err.code, err.reason);
					return;
				}

				const handler = handlers.get(msgType);
				if (handler) {
					handler(msg, streams);
				} else {
					logger('Socket[%s] received unknown Scratch-RPC message', socketId);
					discardStreams(streams, true);
				}
			});

		const handlers = {
			[M.REQUEST]([requestId, methodName, param], streams) {
				const abortController = new AbortController();
				const ctx = new MethodContext(abortController.signal, requestId);
				requests.set(requestId, abortController);
				invokeMethod(ctx, methodName, param, streams, () => {
					requests.delete(requestId);
				});
			},
			[M.NOTIFICATION]([methodName, param], streams) {
				const abortController = new AbortController();
				const ctx = new MethodContext(abortController.signal, null);
				notifications.add(abortController);
				invokeMethod(ctx, methodName, param, streams, () => {
					notifications.delete(abortController);
				});
			},
			[M.CANCELLATION]([requestId]) {
				const abortController = requests.get(requestId);
				if (abortController) {
					requests.delete(requestId);
					abortController.abort();
				}
			},
			[M.STREAM_CHUNK_DATA]([streamId, data]) {
				const receiver = receivedStreams.get(streamId);
				if (receiver) {
					receiver.write(data);
				}
			},
			[M.STREAM_CHUNK_END]([streamId]) {
				const receiver = receivedStreams.get(streamId);
				if (receiver) {
					receivedStreams.delete(streamId);
					receiver.end();
				}
			},
			[M.STREAM_CHUNK_ERROR]([streamId, err]) {
				const receiver = receivedStreams.get(streamId);
				if (receiver) {
					receivedStreams.delete(streamId);
					receiver.error(err);
				}
			},
			[M.STREAM_CANCELLATION]([streamId]) {
				// TODO: if recognized then cancel, else ignore
			},
			[M.STREAM_SIGNAL]([streamId, receivedKiB, availableKiB]) {
				// TODO: if recognized then calculate pause/resume, else ignore
			},
		};

		logger('Socket[%s] opened', socketId);
	};
};

// TODO: allow customization of this error
function methodNotFound() {
	throw new Error('Method not found');
}
