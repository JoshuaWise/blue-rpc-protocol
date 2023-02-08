'use strict';
require('./stream');
const textEncoder = new TextEncoder();

exports.stringToOctets = (str) => textEncoder.encode(str);

// TODO: ScratchClient using web standard WebSocket class
// TODO: properly implement HANDSHAKE_TIMEOUT
