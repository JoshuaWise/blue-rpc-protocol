'use strict';
const Stream = require('./stream');

const HIGH_WATER_MARK = 1024 * 1024 * 10; // TODO: make configurable
const SIGNAL_THRESHOLD = HIGH_WATER_MARK / 8;

module.exports = class StreamReceiver {
	constructor(stream, encoder) {
		this._stream = stream;
		this._encoder = encoder;
		this._shouldDecode = !Stream.isOctetStream(stream);
		this._buffer = [];
		this._bufferSize = 0;
		this._signalledBufferSize = Infinity;
		this._receivedBytes = 0;
		this._ended = false;
		this._destroyed = false;
		this._paused = false;
		this._didSignal = false;
		this.onCancellation = null;
		this.onSignal = null;

		Stream.onResume(stream, () => {
			this._paused = false;
			let index = 0;
			while (index < this._buffer.length && !this._paused) {
				const data = this._buffer[index++];
				this._bufferSize -= data.byteLength;
				this._handleData(data);
			}
			if (!this._destroyed) {
				this._buffer = this._buffer.slice(index);
				if (this._ended) {
					if (!this._bufferSize) {
						Stream.end(this._stream);
					}
				} else {
					this._checkSignal();
				}
			}
		});

		Stream.onCancelled(stream, () => {
			this._buffer = [];
			this._bufferSize = 0;
			this._destroyed = true;
			this.onCancellation();
		});

		Promise.resolve().then(() => {
			if (!this._didSignal) {
				this._checkSignal();
			}
		});
	}

	_checkSignal() {
		if (Math.abs(this._bufferSize - this._signalledBufferSize) > SIGNAL_THRESHOLD) {
			this.onSignal(this._receivedBytes, HIGH_WATER_MARK - this._bufferSize);
			this._signalledBufferSize = this._bufferSize;
			this._didSignal = true;
		}
	}

	_handleData(data) {
		if (this._shouldDecode) {
			let value, streams;
			try {
				const result = this._encoder.decode(data);
				value = result.result;
				streams = result.streams;
			} catch (err) {
				// TODO: this should actually close the entire WebSocket connection
				this.error(new Error('Received invalid MessagePack'));
				this.onCancellation();
				return;
			}
			if (streams.size) {
				// TODO: this should actually close the entire WebSocket connection
				this.error(new Error('Received forbidden stream nesting'));
				this.onCancellation();
				return;
			}
			if (Stream.canWriteNull || value !== null) {
				this._paused = !Stream.write(this._stream, value);
			}
		} else {
			this._paused = !Stream.write(this._stream, data);
		}
	}

	write(data) {
		this._receivedBytes += data.byteLength;
		if (this._paused) {
			this._buffer.push(data);
			this._bufferSize += data.byteLength;
			this._checkSignal();
		} else {
			this._handleData(data);
		}
	}

	end() {
		this._ended = true;
		if (!this._bufferSize) {
			this._buffer = [];
			Stream.end(this._stream);
		}
	}

	error(err) {
		this._buffer = [];
		this._bufferSize = 0;
		this._destroyed = true;
		Stream.error(this._stream, err);
	}
};
