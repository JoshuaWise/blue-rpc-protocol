'use strict';
const tls = require('tls');
const WebSocket = require('ws');
const MethodContext = require('./method-context');
const StreamSender = require('../common/stream-sender');
const StreamReceiver = require('../common/stream-receiver');
const destroyAllStreams = require('../common/destroy-all-streams');
const createIncrementor = require('../common/create-incrementor');
const parseMessage = require('../common/parse-message');
const KnownError = require('../common/known-error');
const Heartbeat = require('../common/heartbeat');
const Encoder = require('../common/encoder');
const Stream = require('../common/stream');
const M = require('../common/message');

module.exports = (methods, logger) => {
	const getSocketId = createIncrementor();

	return (socket, req) => {
		const socketId = getSocketId();
		const conn = createConnectionObject(req);
		const heartbeat = new Heartbeat(3000, 3, onHeartbeat);
		const encoder = new Encoder();
		const requests = new Map();
		const notifications = new Set();
		const sentStreams = new Map();
		const receivedStreams = new Map();

		function onHeartbeat(pingsRemaining) {
			if (pingsRemaining >= 0) {
				socket.ping(Buffer.from([pingsRemaining]));
			} else {
				logger('Socket[%s] heartbeat timed out', socketId);
				socket.close(1001, 'Connection timed out');
				socket.terminate();
			}
		}

		function invokeMethod(ctx, methodName, param, streams, cb) {
			logger('Socket[%s] method invoked: "%s"', socketId, methodName);
			receiveStreams(streams);
			const method = methods.get(methodName) || methodNotFound;
			new Promise(resolve => resolve(method(param, ctx)))
				.then((result) => {
					logger('Socket[%s] method succeeded: "%s"', socketId, methodName);
					sendResponse(ctx, M.RESPONSE_SUCCESS, result);
				}, (err) => {
					logger('Socket[%s] method failed: "%s"\n%s', socketId, methodName, err);
					sendResponse(ctx, M.RESPONSE_FAILURE, normalizeError(err));
				})
				.finally(() => {
					discardUnusedStreams(streams);
					cb();
				});
		}

		function sendResponse(ctx, msgType, value) {
			if (!ctx.isNotification && !ctx.isAborted) {
				let result;
				try {
					result = encoder.encode([msgType, ctx.requestId, value]);
				} catch (err) {
					logger('Socket[%s] error\n%s', socketId, err);
					socket.close(1011, 'Server error');
					destroyAllStreams(value); // Prevent resource leaks
					return;
				}
				socket.send(result.result);
				sendStreams(result.streams);
			} else {
				destroyAllStreams(value);
			}
		}

		function sendStreams(streams) {
			for (const [streamId, stream] of streams) {
				sentStreams.set(streamId, new StreamSender(stream, encoder, {
					onData: (data, cb) => {
						if (sentStreams.has(streamId)) {
							socket.send(encoder.encodeInert(
								[M.STREAM_CHUNK_DATA, streamId, data]
							), cb);
						}
					},
					onEnd: () => {
						if (sentStreams.delete(streamId)) {
							socket.send(encoder.encodeInert(
								[M.STREAM_CHUNK_END, streamId]
							));
						}
					},
					onError: (err) => {
						if (sentStreams.delete(streamId)) {
							try {
								socket.send(encoder.encodeInert(
									[M.STREAM_CHUNK_ERROR, streamId, normalizeError(err)]
								));
							} catch (err) {
								logger('Socket[%s] error\n%s', socketId, err);
								socket.close(1011, 'Server error');
							}
						}
					},
					getBufferedAmount: () => {
						return socket.bufferedAmount;
					},
				}));
			}
		}

		function receiveStreams(streams) {
			for (const [streamId, stream] of streams) {
				receivedStreams.set(streamId, new StreamReceiver(stream, encoder, {
					onCancellation: (err) => {
						if (receivedStreams.delete(streamId)) {
							socket.send(encoder.encodeInert(
								[M.STREAM_CANCELLATION, streamId]
							));
						}
						if (err) {
							logger('Socket[%s] %s', socketId, err.message);
							socket.close(err.code, err.reason);
						}
					},
					onSignal: (credit) => {
						if (receivedStreams.has(streamId)) {
							socket.send(encoder.encodeInert(
								[M.STREAM_SIGNAL, streamId, credit]
							));
						}
					},
				}));
			}
		}

		function discardUnusedStreams(streams) {
			for (const [streamId, stream] of streams) {
				const receiver = receivedStreams.get(streamId);
				if (receiver && !Stream.isLocked(stream)) {
					receiver.error(new Error('BlueRPC: Stream unused'));
				}
			}
		}

		function discardStreams(streams) {
			for (const [streamId, stream] of streams) {
				Stream.cancel(stream);
				socket.send(encoder.encodeInert(
					[M.STREAM_CANCELLATION, streamId]
				));
			}
		}

		function isActive() {
			return !!(requests.size || sentStreams.size || receivedStreams.size);
		}

		socket
			.on('close', (code,  reason) => {
				const err = new Error('BlueRPC: WebSocket disconnected');
				err.code = code;
				err.reason = reason.toString();

				logger('Socket[%s] closed (%s: "%s")', socketId, code, err.reason);
				for (const abortController of requests.values()) {
					abortController.abort();
				}
				for (const abortController of notifications.values()) {
					abortController.abort();
				}
				for (const sender of sentStreams.values()) {
					sender.cancel();
				}
				for (const receiver of receivedStreams.values()) {
					receiver.error(err);
				}
				requests.clear();
				notifications.clear();
				sentStreams.clear();
				receivedStreams.clear();
				heartbeat.stop();
			})
			.on('error', (err) => {
				logger('Socket[%s] error\n%s', socketId, err);
			})
			.on('ping', () => {
				isActive() && heartbeat.reset();
			})
			.on('pong', () => {
				isActive() && heartbeat.reset();
			})
			.on('message', (rawMsg) => {
				isActive() && heartbeat.reset();

				if (socket.readyState !== WebSocket.OPEN) {
					return; // If closing, ignore messages
				}

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

				const handler = handlers[msgType];
				if (handler) {
					handler(msg, streams);
				} else {
					logger('Socket[%s] received unknown BlueRPC message', socketId);
					discardStreams(streams);
				}
			});

		const handlers = {
			[M.REQUEST]([requestId, methodName, param], streams) {
				const abortController = new AbortController();
				const ctx = new MethodContext(abortController.signal, requestId, conn);
				requests.set(requestId, abortController);
				invokeMethod(ctx, methodName, param, streams, () => {
					requests.delete(requestId);
				});
				heartbeat.reset();
			},
			[M.NOTIFICATION]([methodName, param], streams) {
				const abortController = new AbortController();
				const ctx = new MethodContext(abortController.signal, null, conn);
				notifications.add(abortController);
				invokeMethod(ctx, methodName, param, streams, () => {
					notifications.delete(abortController);
				});
				heartbeat.reset();
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
				const sender = sentStreams.get(streamId);
				if (sender) {
					sentStreams.delete(streamId);
					sender.cancel();
				}
			},
			[M.STREAM_SIGNAL]([streamId, credit]) {
				const sender = sentStreams.get(streamId);
				if (sender) {
					sender.signal(credit);
				}
			},
		};

		logger('Socket[%s] opened', socketId);
	};
};

// TODO: allow customization of this error
function methodNotFound() {
	throw new Error('Method not found');
}

function normalizeError(err) {
	if (!(err instanceof Error)) return new Error(String(err));
	if (err instanceof KnownError) return err;
	return new Error(err.message);
}

function createConnectionObject(req) {
	return {
		tls: req.socket instanceof tls.TLSSocket,
		headers: req.headers,
	};
}
