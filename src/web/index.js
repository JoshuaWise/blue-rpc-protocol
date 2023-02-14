'use strict';
require('./stream');
const KnownError = require('../common/known-error');
const BlueClient = require('../common/client');
const BlueConnection = require('./connection');

exports.listen = () => {
	throw new TypeError('Cannot create a BlueRPC server in the browser');
};

// Creates a BlueRPC WebSocket client.
exports.createClient = (url, options) => {
	if (typeof url !== 'string' && !(url instanceof URL)) {
		throw new TypeError('Expected "url" argument to be a string or URL object');
	}
	if (!url) {
		throw new TypeError('Expected "url" argument to be non-empty');
	}

	const connect = async () => {
		const socket = new WebSocket(url);
		socket.binaryType = 'arraybuffer';

		// Wait for the WebSocket to be connected.
		await new Promise((resolve, reject) => {
			let timeoutErr;
			const timer = setTimeout(() => {
				timeoutErr = new Error('WebSocket handshake timed out');
				socket.close();
			}, 1000 * 10);

			const onOpen = () => {
				clearTimeout(timer);
				socket.removeEventListener('open', onOpen);
				socket.removeEventListener('error', onError);
				resolve();
			};
			const onError = () => {
				clearTimeout(timer);
				socket.removeEventListener('open', onOpen);
				socket.removeEventListener('error', onError);
				reject(timeoutErr || new Error('WebSocket failed to connect'));
			};
			socket.addEventListener('open', onOpen);
			socket.addEventListener('error', onError);
		});

		return new BlueConnection(socket);
	};

	return new BlueClient(connect);
};

exports.KnownError = KnownError;
