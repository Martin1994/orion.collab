/*******************************************************************************
 * @license
 * Copyright (c) 2017 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License v1.0
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html).
 *
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/
/*eslint-env browser, amd*/
define([
    'i18n!debug/nls/debugMessages',
	'orion/Deferred',
    'orion/debug/debugSocket'
], function(messages, Deferred, mDebugSocket) {

    'use strict';

    /**
     * A debug service provides breakpoints, watches and highlighted lines management.
     * Here management means loading and saving data from storage, apis of getters and setters, and correspoding events.
     * Note that breakpoints from streaming (remote-only) files won't be presisted.
     * 
     * @class {orion.debug.NativeDeployService}
     * @param {orion.serviceregistry.ServiceRegistry} serviceRegistry
     */
    var NativeDeployService = function(serviceRegistry) {
        this._serviceRegistry = serviceRegistry;

        /**
         * Debug sockets for each configuration.
         * TODO: Currently there is no way to remove a debug socket from here.
         * @private
         * @type {Object.<string, DebugSocket>}
         */
        this._debugSockets = {};

        this._debugPanes = null;

        // Register itself
        serviceRegistry.registerService("orion.project.deploy", this, {
            id: "org.eclipse.orion.client.debug.deploy",
            deployTypes: ["Native"],
            //name: messages["createNew"],
            //tooltip: messages["deploy.cf.tooltip"],
            //validationProperties: [{source: "NoShow" }],
            //logLocationTemplate: "{+OrionHome}/cfui/logs.html#{Name,Target*}",
            priorityForDefault: 8
        });
    };

    /**
     * Create a debug socket if it hasn't been created.
     * @param {Object} launchConf
     * @return {orion.debug.DebugSocket}
     */
    NativeDeployService.prototype._ensureDebugSocket = function(launchConf) {
        var confLocation = launchConf.File.Location;
        var debugSocket = null;
        if (this._debugSockets[confLocation]) {
            // Get the existing one
            debugSocket = this._debugSockets[confLocation];
        } else {
            // Create a new debug socket
            if (!this._debugPanes) {
                this._debugPanes = this._serviceRegistry.getService("orion.debug.debugPanes");
            }
            var debugSocket = new mDebugSocket.DebugSocket(this._serviceRegistry);
            this._debugSockets[confLocation] = debugSocket;
            this._debugPanes.connect(debugSocket);
            // var boundDebuggerStatusHandler = this.debuggerStatusHandler.bind(this);
            // debugSocket.addEventListener("status", boundDebuggerStatusHandler);
        }
        this._debugPanes.activate(debugSocket);
        return debugSocket;
    };

    /**
     * Get deploy progress message
     * @return {string}
     */
    NativeDeployService.prototype.getDeployProgressMessage = function(project, launchConf) {
        return messages['launching'];
    };

    /**
     * Deploy a configuration
     * @return {Deferred}
     */
    NativeDeployService.prototype.deploy = function(project, launchConf) {
        if (launchConf.ConfigurationName) {
            var debugSocket = this._ensureDebugSocket(launchConf);
            debugSocket.setProject(project);
            return this.start(launchConf);
        } else {
            return this.edit(project, launchConf);
        }
    };

    /**
     * Edit a configuration
     * @return {Deferred}
     */
    NativeDeployService.prototype.edit = function(project, launchConf) {
        var url = new URL('../orion/debug/debugDeploymentWizard.html', location.href);
        url.hash = '#' + encodeURIComponent(JSON.stringify({
            ContentLocation: project.ContentLocation,
            AppPath: launchConf.Path,
            ConfParams: launchConf.Parameters,
            ConfName: launchConf.ConfigurationName,
            ProjName: project.Name
        }));
        return new Deferred().resolve({
            UriTemplate: url.href,
            Width: '500px',
            Height: '470px',
            UriTemplateId: 'org.eclipse.orion.client.debug.deploy.uritemplate'
        });
    };

    /**
     * Get the state of debugger
     * @return {Deferred}
     */
    NativeDeployService.prototype.getState = function(launchConf) {
        var debugSocket = this._ensureDebugSocket(launchConf);
        var status = debugSocket.getStatus();
        if (status === mDebugSocket.StatusEvent.STATUS.IDLE) {
            return new Deferred().resolve({
                Name: launchConf.name,
                State: 'STOPPED',
                Message: messages['debugeeStopped']
            });
        } else if (status === mDebugSocket.StatusEvent.STATUS.RUNNING) {
            return new Deferred().resolve({
                Name: launchConf.name,
                State: 'STARTED',
                Message: messages['debugeeRunning']
            });
        } else {
            return new Deferred().resolve({
                Name: launchConf.name,
                State: 'PAUSED',
                Message: messages['debugeePaused']
            });
        }
    };

    /**
     * Get the state of debugger
     * @return {Deferred}
     */
    NativeDeployService.prototype.start = function(launchConf) {
        var debugSocket = this._ensureDebugSocket(launchConf);
        try {
            debugSocket.launch(launchConf.Parameters);
            return new Deferred().resolve({
                Name: launchConf.name,
                State: 'STARTED',
                Message: messages['debugeeRunning']
            });
        } catch (ex) {
            return this.getState(launchConf);
        }
    };

    /**
     * Get the state of debugger
     * @return {Deferred}
     */
    NativeDeployService.prototype.stop = function(launchConf) {
        var debugSocket = this._ensureDebugSocket(launchConf);
        var deferred = new Deferred();
        debugSocket.request('disconnect', {}, function(response) {
            if (!response.success) {
                console.error('Failed to stop debugee.');
            }
            deferred.resolve({
                Name: launchConf.name,
                State: 'STOPPED',
                Message: messages['debugeeStopped']
            });
        });
        return deferred;
    };

    return {
        NativeDeployService: NativeDeployService
    };
});