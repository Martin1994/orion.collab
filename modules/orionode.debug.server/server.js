/*******************************************************************************
 * Copyright (c) 2017 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *	 IBM Corporation - initial API and implementation
 *******************************************************************************/

'use strict';

var express = require('express');
var http = require('http');
var socketio = require('socket.io');
var index = require('./index');

/**
 * Install the module
 * 
 * @param {Express} options.app
 * @param {SocketIO.Server} options.io
 */
function install(options) {
    index.install(options);
}

if (require.main === module) {
    // Start the standalone server
    var app = express();
    // Enables CORS
    var enableCORS = function(req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type');
        res.header('Access-Control-Allow-Credentials', true);

        if (req.method === 'OPTIONS') {
            res.send(200);
        } else {
            next();
        };
    };

    app.use(enableCORS);

    var server = http.createServer(app);
    var io = socketio.listen(server, { 'log level': 1, origins: '*:*' });
    io.origins('*:*');
    install({ app: app, io: io });
    app.get('/', function(req, res) {
        res.send('OK');
    });
    app.use(function(req, res) {
        res.sendStatus(404);
    });
    var port = 8083;
    server.listen(8083);
    console.log('Listening on port ' + port + '...');
}

module.exports.install = install;
