'use strict';
const WebSocket = require('ws');
const MethodContext = require('./method-context');
const StreamReceiver = require('../common/stream-receiver');
const createIncrementor = require('../common/create-incrementor');
const createHeartbeat = require('../common/create-heartbeat');
const validateMessage = require('../common/validate-message');
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
		const abortController = new AbortController();
		const onActivity = createHeartbeat(onHeartbeat, abortController.signal);
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

		function invokeMethod(method, methodName, param, context, callback) {
			logger('Socket[%s] method "%s" invoked', socketId, methodName);
			new Promise(resolve => resolve(method(param, context)))
				.then((returned) => {
					logger('Socket[%s] method "%s" succeeded', socketId, methodName);
					if (!context.isNotification && !context.isAborted) {
						// TODO: encode() could return streams
						socket.send(encoder.encode([M.RESPONSE_SUCCESS, context.requestId, returned]));
					}
				}, (err) => {
					logger('Socket[%s] method "%s" failed: %s', socketId, methodName, err);
					if (!context.isNotification && !context.isAborted) {
						err = err instanceof Error && err.expose ? err : new Error(err.message);
						// TODO: encode() could return streams
						socket.send(encoder.encode([M.RESPONSE_FAILURE, context.requestId, err]));
					}
				})
				.catch((err) => {
					logger('Socket[%s] error: %s', socketId, err);
					socket.close(1011, 'Server error');
				})
				.finally(callback);
		}

		function receiveStreams(streams) {
			for (const [streamId, stream] of streams) {
				const receiver = new StreamReceiver(stream, encoder);
				receivedStreams.set(streamId, receiver);
				receiver.onCancellation = () => {
					if (receivedStreams.delete(streamId)) {
						socket.send(encoder.encodeInert([M.STREAM_CANCELLATION, streamId]));
					}
				};
				receiver.onSignal = (received, available) => {
					if (receivedStreams.has(streamId)) {
						received = Math.floor(received / 1024);
						available = Math.floor(available / 1024);
						socket.send(encoder.encodeInert([M.STREAM_SIGNAL, streamId, received, available]));
					}
				};
			}
		}

		function discardStreams(streams) {
			for (const [streamId, stream] of streams) {
				if (!Stream.isLocked(stream)) {
					Stream.cancel(stream);
					receivedStreams.delete(streamId);
					socket.send(encoder.encodeInert([M.STREAM_CANCELLATION, streamId]));
				}
			}
		}

		socket
			.on('error', (err) => {
				logger('Socket[%s] error: %s', socketId, err);
			})
			.on('close', () => {
				logger('Socket[%s] closed', socketId);
				abortController.abort();
				for (const abortController of requests.values()) {
					abortController.abort();
				}
				for (const abortController of notifications) {
					abortController.abort();
				}
				for (const receiver of receivedStreams.values()) {
					receiver.error(abortController.signal.reason);
				}
				requests.clear();
				notifications.clear();
				receivedStreams.clear();
			})
			.on('ping', () => {
				onActivity();
			})
			.on('pong', () => {
				onActivity();
			})
			.on('message', (rawMsg) => {
				onActivity();

				if (typeof rawMsg === 'string') {
					logger('Socket[%s] received forbidden text frame', socketId);
					socket.close(1003, 'Text frames not allowed');
					return;
				}

				let msg, streams;
				try {
					const result = encoder.decode(rawMsg);
					msg = result.result;
					streams = result.streams;
				} catch (err) {
					logger('Socket[%s] received invalid MessagePack\n%s', socketId, err);
					socket.close(1008, err.msgpackExtensionType ? err.message : 'Invalid MessagePack');
					return;
				}

				if (!validateMessage(msg) || msg[0] === M.RESPONSE_SUCCESS || msg[0] === M.RESPONSE_FAILURE) {
					logger('Socket[%s] received invalid Scratch-RPC message', socketId);
					socket.close(1008, 'Invalid message');
					return;
				}

				const handler = messageHandlers.get(msg[0]);
				if (!handler) {
					logger('Socket[%s] received unknown Scratch-RPC message', socketId);
					discardStreams(streams);
					return;
				}

				if (msg[0] === M.STREAM_CHUNK_ERROR && streams.size) {
					logger('Socket[%s] received forbidden stream nesting', socketId);
					socket.close(1008, 'Stream nesting not allowed');
					return;
				}

				if (msg[0] === M.REQUEST && requests.has(msg[1])) {
					logger('Socket[%s] received duplicate request ID', socketId);
					socket.close(1008, 'Illegal duplicate ID');
					return;
				}

				for (const streamId of streams.keys()) {
					if (receivedStreams.has(streamId)) {
						logger('Socket[%s] received duplicate stream ID', socketId);
						socket.close(1008, 'Illegal duplicate ID');
						return;
					}
				}

				handler(msg, streams);
			});

		const messageHandlers = new Map([
			[M.REQUEST, ([, requestId, methodName, param], streams) => {
				const method = methods.get(methodName);
				if (typeof method === 'function') {
					const abortController = new AbortController();
					const context = new MethodContext(abortController.signal, requestId);
					receiveStreams(streams);
					requests.set(requestId, abortController);
					invokeMethod(method, methodName, param, context, () => {
						requests.delete(requestId);
						discardStreams(streams);
					});
				} else {
					logger('Socket[%s] method "%s" not found', socketId, methodName);
					// TODO: allow customization of this error
					// TODO: encode() could return streams
					socket.send(encoder.encode([M.RESPONSE_FAILURE, requestId, new Error('Method not found')]));
					discardStreams(streams);
				}
			}],
			[M.NOTIFICATION, ([, methodName, param], streams) => {
				const method = methods.get(methodName);
				if (typeof method === 'function') {
					const abortController = new AbortController();
					const context = new MethodContext(abortController.signal, null);
					receiveStreams(streams);
					notifications.add(abortController);
					invokeMethod(method, methodName, param, context, () => {
						notifications.delete(abortController);
						discardStreams(streams);
					});
				} else {
					logger('Socket[%s] method "%s" not found', socketId, methodName);
					discardStreams(streams);
				}
			}],
			[M.CANCELLATION, ([, requestId]) => {
				const abortController = requests.get(requestId);
				if (abortController) {
					abortController.abort();
				}
			}],
			[M.STREAM_CHUNK_DATA, ([, streamId, data]) => {
				const receiver = receivedStreams.get(streamId);
				if (receiver) {
					receiver.write(data);
				}
			}],
			[M.STREAM_CHUNK_END, ([, streamId]) => {
				const receiver = receivedStreams.get(streamId);
				if (receiver) {
					receivedStreams.delete(streamId);
					receiver.end();
				}
			}],
			[M.STREAM_CHUNK_ERROR, ([, streamId, err]) => {
				const receiver = receivedStreams.get(streamId);
				if (receiver) {
					receivedStreams.delete(streamId);
					receiver.error(err);
				}
			}],
			[M.STREAM_CANCELLATION, ([, streamId]) => {
				// TODO: if recognized then cancel, else ignore
			}],
			[M.STREAM_SIGNAL, ([, streamId, receivedKiB, availableKiB]) => {
				// TODO: if recognized then calculate pause/resume, else ignore
			}],
		]);

		logger('Socket[%s] opened', socketId);
	};
};
