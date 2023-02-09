'use strict';
const Stream = require('./stream');

const IDEAL_CHUNK_SIZE = 1024 * 64; // TODO: measure how effective this is (even if it's useless, we still need to limit chunks to 256 KiB)
const HIGH_WATER_MARK = 1024 * 1024;
const LOW_WATER_MARK = HIGH_WATER_MARK / 4;

module.exports = class StreamSender {
	constructor(stream, encoder, { onData, onEnd, onError, getBufferedAmount }) {
		this._stream = stream;
		this._isOctets = Stream.isOctetStream(stream);
		this._chunks = [];
		this._chunksSize = 0;
		this._sentBytes = 0;
		this._destroyed = false;
		this._cancel = null;

		const send = (data) => {
			this._sentBytes += data.byteLength;
			onData(data, onDrain);
			if (getBufferedAmount() > HIGH_WATER_MARK) {
				streamControls.pause();
			}
		};

		const onDrain = () => {
			if (!this._destroyed && getBufferedAmount() < LOW_WATER_MARK) {
				streamControls.resume();
				if (this._chunksSize) {
					flushChunks(IDEAL_CHUNK_SIZE);
				}
			}
		};

		const flushChunks = (requiredChunkSize) => {
			while (
				this._chunksSize >= requiredChunkSize
				|| this._chunksSize && getBufferedAmount() < LOW_WATER_MARK
			) {
				const data = this._chunks.length > 1
					? Stream.concatOctets(this._chunks)
					: this._chunks[0];
				const toSend = data.subarray(0, IDEAL_CHUNK_SIZE);
				const toKeep = data.subarray(IDEAL_CHUNK_SIZE);
				this._chunks = toKeep.byteLength ? [toKeep] : [];
				this._chunksSize = toKeep.byteLength;
				send(toSend);
			}
		};

		const streamControls = Stream.read(stream, {
			onData: (data) => {
				if (this._isOctets) {
					if (typeof data === 'string') {
						data = Stream.stringToOctets(data);
					}
					this._chunks.push(data);
					this._chunksSize += data.byteLength;
					flushChunks(IDEAL_CHUNK_SIZE);
				} else {
					try {
						data = encoder.encodeInert(data);
					} catch (err) {
						// TODO: raise error
						return;
					}
					send(data);
				}
			},
			onEnd: () => {
				flushChunks(1);
				onEnd();
			},
			onError: (err) => {
				this._destroyed = true;
				this._chunks = [];
				this._chunksSize = 0;
				this._cancel = () => {};
				streamControls.cancel(err);
				onError(err);
			},
			onClose: (err) => {
				this._destroyed = true;
				this._chunks = [];
				this._chunksSize = 0;
				this._cancel = () => {};
				onError(err || new Error('Stream was closed prematurely'));
				onData = () => {};
				onEnd = () => {};
				onError = () => {};
				getBufferedAmount = () => 0;
			},
		});

		this._cancel = streamControls.cancel;
	}

	cancel(...reason) {
		this._cancel(...reason);
	}

	signal(receivedKiB, availableKiB) {
		const sentKiB = Math.floor(this._chunksSize / 1024);
		const inFlightKiB = sentKiB - receivedKiB;
		const assumedAvailableKiB = availableKiB - inFlightKiB;
		if (assumedAvailableKiB > 0) {
			// TODO: unpause (measure if this actually helps or hurts)
		} else {
			// TODO: pause (measure if this actually helps or hurts)
		}
	}
};
