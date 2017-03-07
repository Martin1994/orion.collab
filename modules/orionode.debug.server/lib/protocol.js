'use strict';

var VSCodeProtocol = require('vscode-debugadapter/lib/protocol');

var ProtocolServer = function() {
    VSCodeProtocol.ProtocolServer.apply(this, arguments);
};

ProtocolServer.prototype = Object.create(VSCodeProtocol.ProtocolServer.prototype);

ProtocolServer.prototype.handleEvent = function (event) {
};

// TODO: This code are partly from M$! Need to contribute the original repo or do a clean room implementation!
ProtocolServer.prototype._handleData = function (data) {
    this._rawData = Buffer.concat([this._rawData, data]);
    while (true) {
        if (this._contentLength >= 0) {
            if (this._rawData.length >= this._contentLength) {
                var message = this._rawData.toString('utf8', 0, this._contentLength);
                this._rawData = this._rawData.slice(this._contentLength);
                this._contentLength = -1;
                if (message.length > 0) {
                    try {
                        var msg = JSON.parse(message);
                        if (msg.type === 'request') {
                            this.dispatchRequest(msg);
                        }
                        else if (msg.type === 'response') {
                            var response = msg;
                            var clb = this._pendingRequests.get(response.request_seq);
                            if (clb) {
                                this._pendingRequests.delete(response.request_seq);
                                clb(response);
                            }
                        }
                        else if (msg.type === 'event') {
                            this.handleEvent(msg);
                        }
                    }
                    catch (e) {
                        this._emitEvent(new messages_1.Event('error'));
                    }
                }
                continue; // there may be more complete messages to process
            }
        }
        else {
            var idx = this._rawData.indexOf(VSCodeProtocol.ProtocolServer.TWO_CRLF);
            if (idx !== -1) {
                var header = this._rawData.toString('utf8', 0, idx);
                var lines = header.split('\r\n');
                for (var i = 0; i < lines.length; i++) {
                    var pair = lines[i].split(/: +/);
                    if (pair[0] == 'Content-Length') {
                        this._contentLength = +pair[1];
                    }
                }
                this._rawData = this._rawData.slice(idx + VSCodeProtocol.ProtocolServer.TWO_CRLF.length);
                continue;
            }
        }
        break;
    }
};

module.exports.ProtocolServer = ProtocolServer;
