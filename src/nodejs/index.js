'use strict';
require('./stream');
const https = require('https');
const { URL } = require('url');
const { WebSocket, WebSocketServer } = require('ws');
const ScratchClient = require('../common/client');
const ScratchConnection = require('./connection');
const createServerHandler = require('./create-server-handler');
const normalizeServerOptions = require('./normalize-server-options');
const normalizeClientOptions = require('./normalize-client-options');
const getIPs = require('./get-ips');

// Starts a Scratch-RPC WebSocket server, implementing the given methods.
exports.listen = async (options) => {
	options = normalizeServerOptions(options);

	const logger = options.logger;
	const httpServer = options.server;
	const wsServer = new WebSocketServer({
		server: httpServer,
		maxPayload: options.maxPayload,
		perMessageDeflate: options.perMessageDeflate,
		verifyClient: options.verifyClient,
	});

	wsServer.on('connection', createServerHandler(options.methods, logger));

	// Wait for the server to be online.
	await new Promise((resolve, reject) => {
		const onListening = () => {
			httpServer.removeListener('listening', onListening);
			httpServer.removeListener('error', onError);
			resolve();
		};
		const onError = (err) => {
			httpServer.removeListener('listening', onListening);
			httpServer.removeListener('error', onError);
			reject(err);
		};
		httpServer.listen(options.netOpts);
		httpServer.on('listening', onListening);
		httpServer.on('error', onError);
	});

	// Log the available URLs for this server.
	const address = httpServer.address();
	if (typeof address === 'string') {
		logger('Listening at %s', address);
	} else {
		const scheme = httpServer instanceof https.Server ? 'wss' : 'ws';
		for (const ipAddress of getIPs()) {
			logger('Listening at %s://%s:%s', scheme, ipAddress, address.port);
		}
	}

	return wsServer;
};

// Creates a Scratch-RPC WebSocket client.
exports.createClient = (url, options) => {
	if (typeof url !== 'string' && !(url instanceof URL)) {
		throw new TypeError('Expected "url" argument to be a string or URL object');
	}
	if (!url) {
		throw new TypeError('Expected "url" argument to be non-empty');
	}

	options = normalizeClientOptions(options);

	const connect = async () => {
		const socket = new WebSocket(url, [], {
			maxPayload: options.maxPayload,
			perMessageDeflate: options.perMessageDeflate,
			...options.httpOpts,
		});

		// Wait for the WebSocket to be connected.
		await new Promise((resolve, reject) => {
			let timeoutErr;
			const timer = setTimeout(() => {
				timeoutErr = new Error('WebSocket handshake timed out');
				socket.terminate();
			}, 1000 * 10);

			const onOpen = () => {
				clearTimeout(timer);
				socket.removeListener('open', onOpen);
				socket.removeListener('error', onError);
				resolve();
			};
			const onError = (err) => {
				clearTimeout(timer);
				socket.removeListener('open', onOpen);
				socket.removeListener('error', onError);
				reject(timeoutErr || err);
			};
			socket.on('open', onOpen);
			socket.on('error', onError);
		});

		return new ScratchConnection(socket);
	};

	return new ScratchClient(connect);
};
