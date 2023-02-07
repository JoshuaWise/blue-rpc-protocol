'use strict';

/*
	An enum containing each message type in Scratch-RPC.
 */

module.exports = {
	REQUEST: 0,
	NOTIFICATION: 1,
	RESPONSE_SUCCESS: 2,
	RESPONSE_FAILURE: 3,
	CANCELLATION: 4,
	STREAM_CHUNK_DATA: 5,
	STREAM_CHUNK_END: 6,
	STREAM_CHUNK_ERROR: 7,
	STREAM_CANCELLATION: 8,
	STREAM_SIGNAL: 9,
};
