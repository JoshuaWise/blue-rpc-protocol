'use strict';
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
	target: 'web',
	mode: 'production',
	devtool: 'source-map',
	entry: './src/web/index.js',
	optimization: {
		minimize: true,
		minimizer: [
			new TerserPlugin({
				terserOptions: {
					keep_classnames: true,
				},
			}),
		],
	},
	output: {
		filename: 'blue-rpc.min.js',
		library: {
			name: 'BlueRPC',
			type: 'umd',
		},
	},
};
