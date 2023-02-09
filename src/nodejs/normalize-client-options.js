'use strict';
const MAX_PAYLOAD = 1024 * 1024;
const CLIENT_COMPRESSION = {
	serverNoContextTakeover: false,
	clientNoContextTakeover: true,
	serverMaxWindowBits: 15,
	clientMaxWindowBits: 15,
	threshold: 1024 * 8,
	concurrencyLimit: 5,
};

// Validates and normalizes the options expected by ScratchRPC.createClient().
module.exports = ({ ...options } = {}) => {
	const {
		maxPayload,
		perMessageDeflate,
		followRedirects: _ignored01,
		generateMask: _ignored02,
		handshakeTimeout: _ignored03,
		maxRedirects: _ignored05,
		origin: _ignored06,
		protocolVersion: _ignored07,
		skipUTF8Validation: _ignored08,
		...httpOpts
	} = options;

	if (maxPayload != null) {
		if (typeof maxPayload !== 'number') {
			throw new TypeError('Expected "maxPayload" option to be a number');
		}
		if (Number.isNaN(maxPayload) || maxPayload < 0) {
			throw new RangeError('Expected "maxPayload" option to be a positive number');
		}
		if (maxPayload !== Infinity && maxPayload > 0x7fffffff) {
			throw new RangeError('Expected "maxPayload" option to be no greater than 2147483647');
		}
		if (maxPayload !== 0 && maxPayload < 0x40000) {
			throw new RangeError('Expected "maxPayload" option to be no less than 262144');
		}
	}
	if (perMessageDeflate !== undefined && typeof perMessageDeflate !== 'object' && typeof perMessageDeflate !== 'boolean' || Array.isArray(perMessageDeflate)) {
		throw new TypeError('Expected "perMessageDeflate" option to be an object');
	}

	return {
		maxPayload: maxPayload === undefined ? MAX_PAYLOAD : maxPayload | 0,
		perMessageDeflate: perMessageDeflate === undefined ? CLIENT_COMPRESSION : perMessageDeflate || false,
		httpOpts,
	};
};
