'use strict';
const WebSocket = require('ws');
const MethodContext = require('./method-context');
const StreamReceiver = require('./stream-receiver');
const createIncrementor = require('./create-incrementor');
const createHeartbeat = require('./create-heartbeat');
const validate = require('./validate');
const Encoder = require('./encoder');
const Stream = require('./stream');

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

// TODO: handling of duplicate Stream IDs or Request IDs is not currently in the spec

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
						socket.send(encoder.encode([2, context.requestId, returned]));
					}
				}, (err) => {
					logger('Socket[%s] method "%s" failed: %s', socketId, methodName, err);
					if (!context.isNotification && !context.isAborted) {
						err = err instanceof Error && err.expose ? err : new Error(err.message);
						// TODO: encode() could return streams
						socket.send(encoder.encode([3, context.requestId, err]));
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
						socket.send(encoder.encodeWithoutStreams([8, streamId]));
					}
				};
				receiver.onSignal = (received, available) => {
					if (receivedStreams.has(streamId)) {
						received = Math.floor(received / 1024);
						available = Math.floor(available / 1024);
						socket.send(encoder.encodeWithoutStreams([9, streamId, received, available]));
					}
				};
			}
		}

		function discardStreams(streams) {
			for (const [streamId, stream] of streams) {
				if (!Stream.isLocked(stream)) {
					Stream.cancel(stream);
					receivedStreams.delete(streamId);
					socket.send(encoder.encodeWithoutStreams([8, streamId]));
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

				if (!validate.AnyMessage(msg)) {
					logger('Socket[%s] received invalid Scratch-RPC message', socketId);
					socket.close(1008, 'Invalid message');
					return;
				}

				const config = messageHandlers.get(msg[0]);
				if (!config) {
					logger('Socket[%s] received unknown Scratch-RPC message', socketId);
					discardStreams(streams);
					return;
				}

				if (!config.validate(msg)) {
					logger('Socket[%s] received improper Scratch-RPC message', socketId);
					socket.close(1008, 'Improper message');
					return;
				}

				if (msg[0] === 7 && streams.size) {
					logger('Socket[%s] received forbidden stream nesting', socketId);
					socket.close(1008, 'Stream nesting not allowed');
					return;
				}

				if (msg[0] === 0 && requests.has(msg[1])) {
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
			[0, {
				validate: validate.Request,
				handler: ([, requestId, methodName, param], streams) => {
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
						socket.send(encoder.encode([3, requestId, new Error('Method not found')]));
						discardStreams(streams);
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
				handler: ([, streamId, data]) => {
					const receiver = receivedStreams.get(streamId);
					if (receiver) {
						receiver.write(data);
					}
				},
			}],
			[6, {
				validate: validate.StreamChunkEnd,
				handler: ([, streamId]) => {
					const receiver = receivedStreams.get(streamId);
					if (receiver) {
						receivedStreams.delete(streamId);
						receiver.end();
					}
				},
			}],
			[7, {
				validate: validate.StreamChunkError,
				handler: ([, streamId, err]) => {
					const receiver = receivedStreams.get(streamId);
					if (receiver) {
						receivedStreams.delete(streamId);
						receiver.error(err);
					}
				},
			}],
			[8, {
				validate: validate.StreamCancellation,
				handler: ([, streamId]) => {
					// TODO: if recognized then cancel, else ignore
				},
			}],
			[9, {
				validate: validate.StreamSignal,
				handler: ([, streamId, receivedKiB, availableKiB]) => {
					// TODO: if recognized then calculate pause/resume, else ignore
				},
			}],
		]);

		logger('Socket[%s] opened', socketId);
	};
};
