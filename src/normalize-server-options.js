'use strict';
const util = require('util');
const http = require('http');
const https = require('https');

const MAX_PAYLOAD = 1024 * 1024 * 1024;
const MAX_BUFFERED_PAYLOAD = 1024 * 1024;
const SERVER_COMPRESSION = {
	serverNoContextTakeover: true,
	clientNoContextTakeover: false,
	serverMaxWindowBits: 15,
	clientMaxWindowBits: 15,
	threshold: 1024 * 64,
	concurrencyLimit: 5,
};

// Validates and normalizes the options expected by ScratchRPC.listen().
module.exports = ({ ...options } = {}) => {
	const {
		server,
		methods,
		maxPayload,
		maxBufferedPayload,
		perMessageDeflate,
		verifyClient,
		logger,
		...netOpts
	} = options;

	if (!(server instanceof http.Server || server instanceof https.Server)) {
		throw new TypeError('Expected "server" option to be an HTTP or HTTPS server');
	}
	if (methods !== undefined && typeof methods !== 'object' || Array.isArray(methods)) {
		throw new TypeError('Expected "methods" option to be an object');
	}
	if (maxPayload != null) {
		if (typeof maxPayload !== 'number') {
			throw new TypeError('Expected "maxPayload" option to be a number');
		}
		if (Number.isNaN(maxPayload) || maxPayload < 0) {
			throw new RangeError('Expected "maxPayload" option to be a positive number');
		}
		if (maxPayload !== Infinity && maxPayload > Number.MAX_SAFE_INTEGER) {
			throw new RangeError('Expected "maxPayload" option to be no greater than MAX_SAFE_INTEGER');
		}
	}
	if (maxBufferedPayload != null) {
		if (typeof maxBufferedPayload !== 'number') {
			throw new TypeError('Expected "maxBufferedPayload" option to be a number');
		}
		if (Number.isNaN(maxBufferedPayload) || maxBufferedPayload < 0) {
			throw new RangeError('Expected "maxBufferedPayload" option to be a positive number');
		}
		if (maxBufferedPayload !== Infinity && maxBufferedPayload > 0x7fffffff) {
			throw new RangeError('Expected "maxBufferedPayload" option to be no greater than 2147483647');
		}
	}
	if (perMessageDeflate !== undefined && typeof perMessageDeflate !== 'object' && typeof perMessageDeflate !== 'boolean' || Array.isArray(perMessageDeflate)) {
		throw new TypeError('Expected "perMessageDeflate" option to be an object');
	}
	if (verifyClient != null && typeof verifyClient !== 'function') {
		throw new TypeError('Expected "verifyClient" option to be a function');
	}
	if (logger != null && typeof logger !== 'function') {
		throw new TypeError('Expected "logger" option to be a function');
	}
	if (!('port' in netOpts || 'path' in netOpts || 'handle' in netOpts || 'fd' in netOpts)) {
		netOpts.port = server instanceof https.Server ? 443 : 80;
	}

	return {
		server,
		methods: new Map(Object.entries(methods || {})),
		maxPayload: maxPayload === undefined ? MAX_PAYLOAD : Math.floor(maxPayload) || Infinity,
		maxBufferedPayload: maxBufferedPayload === undefined ? MAX_BUFFERED_PAYLOAD : maxBufferedPayload | 0,
		perMessageDeflate: perMessageDeflate === undefined ? SERVER_COMPRESSION : perMessageDeflate || false,
		verifyClient: verifyClient || null,
		logger: logger ? createLogger(logger) : () => {},
		netOpts,
	};
};

function createLogger(outputCallback) {
	return (...args) => {
		outputCallback(util.format(...args));
	};
}
