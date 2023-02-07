'use strict';
const WebSocket = require('ws');
const MethodContext = require('./method-context');
const createIncrementor = require('./create-incrementor');
const createHeartbeat = require('./create-heartbeat');
const validate = require('./validate');
const Encoder = require('./encoder');

// TODO: after encoding a stream to send
//   on data/end/error, send Stream Chunk
//   upon receiving Stream Cancel, destroy the stream
//   DO NOT store this in the set of "open Stream IDs"

// TODO: after decoding a stream that was received
//   add to set of "open Stream IDs" (map id to new Stream instance)
//   upon receiving Stream Chunk, write/end/error the stream
//   if Stream is destroyed/cancelled, send Stream Cancel
//   wrap it in an Object Steam, if applicable

// TODO: pass abortSignal for destroying streams
// TODO: for buffering purposes, all Streams are internally binary streams
//   but Object Streams are eventually exposed to the user as object streams.

// TODO: limit octet stream chunks to be 256 KiB in size, at most
// TODO: maybe buffer/group octet stream chunks to be at least 64 KiB, if waiting anyways
// TODO: when sending a stream, pause/resume based on ws.bufferedAmount (not just Stream Signals)

// TODO: note that msgpack decode AND encode can both throw
// TODO: make sure we are not allowing ourselves to encode streams in streams

// TODO: what to do if we receive duplicate Stream IDs or Request IDs?
//   this handling is not currently in the spec

module.exports = (methods, logger) => {
	const getSocketId = createIncrementor();

	return (socket) => {
		const socketId = getSocketId();
		const abortController = new AbortController();
		const onActivity = createHeartbeat(onHeartbeat, abortController.signal);
		const encoder = new Encoder();
		const requests = new Map();
		const notifications = new Set();

		function onHeartbeat(isAlive) {
			if (isAlive) {
				socket.ping();
			} else {
				logger('Socket[%s] heartbeat failure', socketId);
				socket.close(1001, 'Connection timed out');
				socket.terminate();
			}
		}

		function sendStreamCancellations(streams) {
			for (const streamId of streams.keys()) {
				socket.send(encoder.encode([8, streamId]));
			}
		}

		function invokeMethod(method, methodName, param, context, callback) {
			logger('Socket[%s] method "%s" invoked', socketId, methodName);
			new Promise(resolve => resolve(method(param, context)))
				.then((returned) => {
					logger('Socket[%s] method "%s" succeeded', socketId, methodName);
					if (!context.isNotification && !context.isAborted) {
						socket.send(encoder.encode([2, context.requestId, returned]));
					}
				}, (err) => {
					logger('Socket[%s] method "%s" failed: %s', socketId, methodName, err);
					if (!context.isNotification && !context.isAborted) {
						err = err instanceof Error && err.expose ? err : new Error(err.message);
						socket.send(encoder.encode([3, context.requestId, err]));
					}
				})
				.catch((err) => {
					logger('Socket[%s] error: %s', socketId, err);
					socket.close(1011, 'Server error');
				})
				.finally(callback);
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
				requests.clear();
				notifications.clear();
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

				if (!validate.AnyMessage(msg)) {
					logger('Socket[%s] received invalid Scratch-RPC message', socketId);
					socket.close(1008, 'Invalid message');
					return;
				}

				const config = messageHandlers.get(msg[0]);
				if (!config) {
					logger('Socket[%s] received unknown Scratch-RPC message', socketId);
					sendStreamCancellations(streams);
					return;
				}

				if (!config.validate(msg)) {
					logger('Socket[%s] received improper Scratch-RPC message', socketId);
					socket.close(1008, 'Improper message');
					return;
				}

				if (config.noNestedStreams && streams.size) {
					logger('Socket[%s] received forbidden stream nesting', socketId);
					socket.close(1008, 'Stream nesting not allowed');
					return;
				}

				if (msg[0] === 0 && requests.has(msg[1])) {
					logger('Socket[%s] received duplicate request ID', socketId);
					socket.close(1008, 'Illegal duplicate ID');
					return;
				}

				handler(msg, streams);
			});

		const messageHandlers = new Map([
			[0, {
				validate: validate.Request,
				handler: ([, requestId, methodName, param], streams) => {
					const method = methods.get(methodName);
					if (typeof method === 'function') {
						const abortController = new AbortController();
						const context = new MethodContext(abortController.signal, requestId);
						requests.set(requestId, abortController);
						invokeMethod(method, methodName, param, context, () => {
							requests.delete(requestId);
						});
					} else {
						logger('Socket[%s] method "%s" not found', socketId, methodName);
						// TODO: allow customization of this error
						socket.send(encoder.encode([3, requestId, new Error('Method not found')]));
						sendStreamCancellations(streams);
					}
				},
			}],
			[1, {
				validate: validate.Notification,
				handler: ([, methodName, param], streams) => {
					const method = methods.get(methodName);
					if (typeof method === 'function') {
						const abortController = new AbortController();
						const context = new MethodContext(abortController.signal, null);
						notifications.add(abortController);
						invokeMethod(method, methodName, param, context, () => {
							notifications.delete(abortController);
						});
					} else {
						logger('Socket[%s] method "%s" not found', socketId, methodName);
						sendStreamCancellations(streams);
					}
				},
			}],
			[2, {
				validate: () => false,
			}],
			[3, {
				validate: () => false,
			}],
			[4, {
				validate: validate.Cancellation,
				handler: ([, requestId]) => {
					const abortController = requests.get(requestId);
					if (abortController) {
						abortController.abort();
					}
				},
			}],
			[5, {
				validate: validate.StreamChunkData,
				noNestedStreams: true,
				handler: (msg) => {
					// TODO: if recognized then handle, else ignore
				},
			}],
			[6, {
				validate: validate.StreamChunkEnd,
				handler: (msg) => {
					// TODO: if recognized then handle, else ignore
				},
			}],
			[7, {
				validate: validate.StreamChunkError,
				noNestedStreams: true,
				handler: (msg) => {
					// TODO: if recognized then handle, else ignore
				},
			}],
			[8, {
				validate: validate.StreamCancellation,
				handler: () => {
					// TODO: if recognized then cancel, else ignore
				},
			}],
			[9, {
				validate: validate.StreamSignal,
				handler: () => {
					// TODO: if recognized then calculate pause/resume, else ignore
				},
			}],
		]);

		logger('Socket[%s] opened', socketId);
	};
};
