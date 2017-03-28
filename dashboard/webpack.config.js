var path = require('path');
var webpack = require('webpack');
var ExtractTextPlugin = require('extract-text-webpack-plugin');
var HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    app: './src/index.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js'
  },
  module: {
    rules: [{
      test: /\.css$/,
      use: ExtractTextPlugin.extract({
        use: 'css-loader'
      })
    }, {
      test: /\.(ttf|otf|eot|svg|woff(2)?)(\?[a-z0-9]+)?$/,
      loader: 'file-loader?name=fonts/[name].[ext]'
    }],
    loaders: [
      {test: /\.html$/, loader: 'html-loader'}
    ]
  },
  plugins: [
    new webpack.optimize.UglifyJsPlugin(),
    new ExtractTextPlugin({
      filename: '[name].bundle.css',
      disable: false,
      allChunks: true
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: './index.html'
    })
  ]
};
