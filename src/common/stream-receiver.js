'use strict';
const Stream = require('./stream');
const { parseStream } = require('./parse-message');

// TODO: make backpressure configurable: optimistic, defensive, disabled
// TODO: decide on whether sender should start paused (with initial signal required)
const HIGH_WATER_MARK = 1024 * 1024 * 8;

module.exports = class StreamReceiver {
	constructor(stream, encoder, { onCancellation, onSignal }) {
		this._stream = stream;
		this._encoder = encoder;
		this._shouldDecode = !Stream.isOctetStream(stream);
		this._buffer = [];
		this._bufferSize = 0;
		this._credit = HIGH_WATER_MARK;
		this._backpressure = false;
		this._paused = false;
		this._ended = false;
		this._destroyed = false;
		this._onCancellation = onCancellation;
		this._onSignal = onSignal;

		this._writer = Stream.populate(stream, {
			onResume: () => {
				this._paused = false;
				let index = 0;
				while (index < this._buffer.length && !this._paused) {
					const data = this._buffer[index++];
					this._bufferSize -= data.byteLength;
					this._handleData(data);
				}
				if (!this._destroyed) {
					// TODO: this could be optimized by using a real Queue data structure
					this._buffer = this._buffer.slice(index);
					if (this._ended) {
						if (!this._bufferSize) {
							this._writer.end();
						}
					} else {
						this._checkSignal();
					}
				}
			},
			onDestroyed: () => {
				this._buffer = [];
				this._bufferSize = 0;
				this._destroyed = true;
				this._onCancellation();
				this._onCancellation = () => {};
				this._onSignal = () => {};
				this._writer.write = () => {};
				this._writer.end = () => {};
				this._writer.error = () => {};
			},
		});
	}

	_checkSignal() {
		if (this._backpressure) {
			if (this._bufferSize === 0) {
				this._backpressure = false;
				this._onSignal(null);
			} else if (this._credit > 0) {
				this._onSignal(this._credit);
				this._credit = 0;
			}
		} else {
			if (this._bufferSize > HIGH_WATER_MARK) {
				this._backpressure = true;
				this._onSignal(this._credit);
				this._credit = 0;
			}
		}
	}

	_handleData(data) {
		if (this._shouldDecode) {
			let value;
			try {
				value = parseStream(data, this._encoder);
			} catch (err) {
				this._onCancellation(err);
				this.error(new Error(`BlueRPC: ${err.message}`));
				return;
			}
			if (Stream.canWriteNull || value !== null) {
				this._paused = !this._writer.write(value);
			}
		} else {
			this._paused = !this._writer.write(data);
		}
		this._credit += data.byteLength;
	}

	write(data) {
		if (this._paused) {
			this._buffer.push(data);
			this._bufferSize += data.byteLength;
			this._checkSignal();
		} else {
			this._handleData(data);
			if (!this._destroyed && !this._ended) {
				this._checkSignal();
			}
		}
	}

	end() {
		this._ended = true;
		if (!this._bufferSize) {
			this._buffer = [];
			this._writer.end();
		}
	}

	error(err) {
		// We need to delay this by one tick, so that clients who received the
		// stream within a response are guaranteed access to the stream before
		// the "error" event is emitted.
		Promise.resolve().then(() => {
			this._buffer = [];
			this._bufferSize = 0;
			this._destroyed = true;
			this._writer.error(err);
		});
	}
};
