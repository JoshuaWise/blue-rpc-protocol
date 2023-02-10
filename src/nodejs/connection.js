'use strict';
const WebSocket = require('ws');
const StreamSender = require('../common/stream-sender');
const StreamReceiver = require('../common/stream-receiver');
const destroyAllStreams = require('../common/destroy-all-streams');
const createIncrementor = require('../common/create-incrementor');
const parseMessage = require('../common/parse-message');
const Timer = require('../common/timer');
const Encoder = require('../common/encoder');
const Stream = require('../common/stream');
const M = require('../common/message');

module.exports = class BlueConnection extends EventTarget {
	constructor(socket) {
		if (!(socket instanceof WebSocket)) {
			throw new TypeError('Expected first argument to be a WebSocket');
		}
		if (socket.readyState !== WebSocket.OPEN) {
			throw new TypeError('Expected WebSocket to be in the OPEN state');
		}

		super();
		let error = null;
		let isOldConnection = false;
		const getRequestId = createIncrementor();
		const timer = new Timer(15 * 1000, onTimeout);
		const encoder = new Encoder();
		const requests = new Map();
		const sentStreams = new Map();
		const receivedStreams = new Map();
		updateRef();

		function onTimeout() {
			socket.close(1001, 'Connection timed out');
			socket.terminate();
		}

		function updateRef() {
			if (requests.size || sentStreams.size || receivedStreams.size) {
				socket._socket.ref();
			} else {
				socket._socket.unref();
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
							updateRef();
						}
					},
					onError: (err) => {
						if (sentStreams.delete(streamId)) {
							// TODO: encoding this Error can throw
							socket.send(encoder.encodeInert(
								[M.STREAM_CHUNK_ERROR, streamId, normalizeError(err)]
							));
							updateRef();
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
							updateRef();
						}
						if (err) {
							error = error || new Error(`BlueRPC: ${err.message}`);
							socket.close(err.code, err.reason);
						}
					},
					onSignal: (received, available) => {
						if (receivedStreams.has(streamId)) {
							const receivedKiB = Math.floor(received / 1024);
							const availableKiB = Math.floor(available / 1024);
							socket.send(encoder.encodeInert(
								[M.STREAM_SIGNAL, streamId, receivedKiB, availableKiB]
							));
						}
					},
				}));
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

		socket
			.on('close', (code, reason) => {
				this.dispatchEvent(
					Object.assign(new Event('close'), { error, code, reason })
				);
				for (const resolver of requests.values()) {
					resolver.reject(new Error('BlueRPC: WebSocket disconnected'));
				}
				for (const sender of sentStreams.values()) {
					sender.cancel();
				}
				for (const receiver of receivedStreams.values()) {
					receiver.error(new Error('BlueRPC: WebSocket disconnected'));
				}
				requests.clear();
				sentStreams.clear();
				receivedStreams.clear();
				timer.stop();
			})
			.on('error', (err) => {
				error = error || err;
			})
			.on('ping', (data) => {
				isOldConnection = data[0] === 0;
				timer.reset();
			})
			.on('message', (rawMsg) => {
				timer.reset();

				let msgType, msg, streams;
				try {
					[msgType, msg, streams] = parseMessage(
						rawMsg, encoder, handlers, receivedStreams
					);
				} catch (err) {
					error = error || new Error(`BlueRPC: ${err.message}`);
					socket.close(err.code, err.reason);
					return;
				}

				const handler = handlers[msgType];
				if (handler) {
					handler(msg, streams);
				} else {
					discardStreams(streams);
				}
			});

		const handlers = {
			[M.RESPONSE_SUCCESS]([requestId, result], streams) {
				const resolver = requests.get(requestId);
				if (resolver) {
					requests.delete(requestId);
					resolver.resolve(result);
					receiveStreams(streams);
					updateRef();
				} else {
					discardStreams(streams);
				}
			},
			[M.RESPONSE_FAILURE]([requestId, err], streams) {
				const resolver = requests.get(requestId);
				if (resolver) {
					requests.delete(requestId);
					resolver.reject(err);
					receiveStreams(streams);
					updateRef();
				} else {
					discardStreams(streams);
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
					updateRef();
				}
			},
			[M.STREAM_CHUNK_ERROR]([streamId, err]) {
				const receiver = receivedStreams.get(streamId);
				if (receiver) {
					receivedStreams.delete(streamId);
					receiver.error(err);
					updateRef();
				}
			},
			[M.STREAM_CANCELLATION]([streamId]) {
				const sender = sentStreams.get(streamId);
				if (sender) {
					sentStreams.delete(streamId);
					sender.cancel();
					updateRef();
				}
			},
			[M.STREAM_SIGNAL]([streamId, receivedKiB, availableKiB]) {
				const sender = sentStreams.get(streamId);
				if (sender) {
					sender.signal(receivedKiB, availableKiB);
				}
			},
		};

		Object.assign(this, {
			invoke(methodName, param, abortSignal) {
				return new Promise((resolve, reject) => {
					if (typeof methodName !== 'string') {
						throw new TypeError('Expected "methodName" argument to be a string');
					}
					if (abortSignal instanceof AbortSignal && abortSignal.aborted) {
						destroyAllStreams(param); // Prevent resource leaks
						throw abortSignal.reason;
					}
					const requestId = getRequestId();
					let result;
					try {
						result = encoder.encode([M.REQUEST, requestId, methodName, param]);
					} catch (err) {
						reject(err);
						destroyAllStreams(param); // Prevent resource leaks
						return;
					}
					socket.send(result.result);
					sendStreams(result.streams);
					requests.set(requestId, { resolve, reject });
					updateRef();
					if (abortSignal instanceof AbortSignal) {
						abortSignal.addEventListener('abort', () => {
							if (requests.delete(requestId)) {
								reject(abortSignal.reason);
								socket.send(encoder.encodeInert([M.CANCELLATION, requestId]));
								updateRef();
							}
							for (const streamId of result.streams.keys()) {
								const sender = sentStreams.get(streamId);
								if (sender) sender.cancel(abortSignal.reason);
							}
						});
					}
				});
			},

			notify(methodName, param) {
				if (typeof methodName !== 'string') {
					throw new TypeError('Expected "methodName" argument to be a string');
				}
				let result;
				try {
					result = encoder.encode([M.NOTIFICATION, methodName, param]);
				} catch (err) {
					destroyAllStreams(param); // Prevent resource leaks
					throw err;
				}
				socket.send(result.result);
				sendStreams(result.streams);
				updateRef();
			},

			close(code, reason) {
				socket.close(code, reason);
			},

			get isOpen() {
				return socket.readyState === WebSocket.OPEN;
			},

			get isOld() {
				return isOldConnection;
			},
		});
	}
};

// TODO: we dont actually want to expose the "expose" property
function normalizeError(err) {
	if (!(err instanceof Error)) return new Error(err);
	if (!err.expose) return new Error(err.message);
	return err;
}
