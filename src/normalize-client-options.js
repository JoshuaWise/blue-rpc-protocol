'use strict';
const CLIENT_COMPRESSION = {
	serverNoContextTakeover: false,
	clientNoContextTakeover: true,
	serverMaxWindowBits: 15,
	clientMaxWindowBits: 15,
	threshold: 1024 * 64,
	concurrencyLimit: 5,
};

// Validates and normalizes the options expected by ScratchRPC.connect().
module.exports = ({ ...options } = {}) => {
	const {
		perMessageDeflate,
		followRedirects: _ignored01,
		generateMask: _ignored02,
		handshakeTimeout: _ignored03,
		maxPayload: _ignored04,
		maxRedirects: _ignored05,
		origin: _ignored06,
		protocolVersion: _ignored07,
		skipUTF8Validation: _ignored08,
		...httpOpts
	} = options;

	if (perMessageDeflate !== undefined && typeof perMessageDeflate !== 'object' && typeof perMessageDeflate !== 'boolean' || Array.isArray(perMessageDeflate)) {
		throw new TypeError('Expected "perMessageDeflate" option to be an object');
	}

	return {
		perMessageDeflate: perMessageDeflate === undefined ? CLIENT_COMPRESSION : perMessageDeflate || false,
		httpOpts,
	};
};
