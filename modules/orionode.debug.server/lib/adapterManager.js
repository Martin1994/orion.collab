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

var adaptersList = require('../adapters.json');
var logger = require('./logger');
var DebugAdapter = require('./debugAdapter');
var path = require('path');

var adaptersConfig = {};
var adaptersCwd = {};

var adapterModules = Object.keys(adaptersList);

var IGNORED_ADAPTERS = {
    "extensionHost": true
};

// Get all available debug adapters
adapterModules.forEach(function(adapterModule) {
    var packageInfo = null;
    try {
        packageInfo = require(path.join('..', 'adapters', adapterModule, 'package.json'));
        var adaptersProvided = packageInfo.contributes.debuggers;
        adaptersProvided.forEach(function(adapterInfo) {
            var adapterType = adapterInfo.type;
            if (adaptersConfig[adapterType]) {
                logger.log(adapterType + ' has been registered.', logger.MessageType.ERROR);
            } else if (IGNORED_ADAPTERS[adapterType]) {
                logger.log('Ignore ' + adapterType + '.', logger.MessageType.INITIALIZATION | logger.MessageType.VERBOSE);
            } else {
                adaptersConfig[adapterType] = adapterInfo;
                adaptersCwd[adapterType] = path.join(__dirname, '..', 'adapters', adapterModule);
            }
        });
    } catch (ex) {
        logger.log(adapterType + ' cannot be loaded.', logger.MessageType.ERROR);
    }
});

logger.log('Loaded adapters: ' + Object.keys(adaptersConfig).join(', ') + '.', logger.MessageType.INITIALIZATION);

/**
 * Create a new adapter instance
 * @return {DebugAdapter}
 */
function createAdapter(type) {
    var adapterConfig = adaptersConfig[type];
    if (!adapterConfig) {
        throw new Error('Adapter type ' + type + ' has not been registered.');
    }
    return new DebugAdapter(adaptersConfig[type], adaptersCwd[type])
}

module.exports.createAdapter = createAdapter;
module.exports.types = Object.keys(adaptersConfig);
