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
	'orion/objects',
	'i18n!orion/widgets/nls/messages',
	'text!orion/widgets/projects/RunBar.html',
	'orion/webui/littlelib',
	'orion/i18nUtil',
    'orion/Deferred',
    'orion/debug/debugSocket'
], function(objects, messages, RunBarTemplate, lib, i18nUtil, Deferred, mDebugSocket) {
    'use strict';

    /**
	 * Creates a new RunBar for native debug.
	 * @class NativeRunBar
	 * @name orion.projects.RunBar
	 * @param options
	 * @param options.parentNode
	 * @param options.serviceRegistry
	 * @param options.commandRegistry
	 * @param options.fileClient
	 * @param options.progressService
	 * @param options.preferencesService
	 * @param options.statusService
	 * @param options.actionScopeId
	 */
    var NativeRunBar = function(options) {
		this._project = null;
		this._parentNode = options.parentNode;
		this._serviceRegistry = options.serviceRegistry;
		this._commandRegistry = options.commandRegistry;
		this._fileClient = options.fileClient;
		this._progressService = options.progressService;
		this._preferencesService = options.preferencesService;
		this.statusService = options.statusService;
		this.actionScopeId = options.actionScopeId;
		this._projectCommands = options.projectCommands;
		this._projectClient = options.projectClient;
		this._preferences = options.preferences;
		this._editorInputManager = options.editorInputManager;
        this._debugSockets = {};
    };

    /**
     * Initialize the run bar
     */
    NativeRunBar.prototype.init = function() {
        var deferred = new Deferred();

        this._domNode = lib.createNodes(RunBarTemplate);
        if (this._domNode) {
            this._parentNode.appendChild(this._domNode);
                            
            this._playButton = lib.$("button.playButton", this._domNode);
            this._boundPlayButtonListener = this.launchDebugTarget.bind(this);
            this._playButton.addEventListener("click", this._boundPlayButtonListener); 
            
            this._stopButton = lib.$("button.stopButton", this._domNode);
            this._boundStopButtonListener = this.disconnectDebugTarget.bind(this);
            this._stopButton.addEventListener("click", this._boundStopButtonListener);
            this._stopButton.classList.add("disabled");

            this._appName = lib.$(".appName", this._domNode);
            this._appInfo = lib.$(".appInfoSpan", this._domNode);

            this._appLink = lib.$(".appLink", this._domNode);
            //this._appLink.addEventListener("click", this._boundLinkClickListener);
            
            this._logsLink = lib.$(".logsLink", this._domNode);

            this._statusLight = lib.$(".statusLight", this._domNode);

            this._configurationBtn = document.createElement('button');
            this._configurationBtnLabel = lib.$(".dropdownTriggerButtonLabel", this._domNode);
            this._configurationBtnLabel.parentNode.appendChild(this._configurationBtn);
            this._configurationBtnLabel.parentNode.removeChild(this._configurationBtnLabel);
            this._configurationBtn.appendChild(this._configurationBtnLabel);
            this._configurationBtn.classList.add("dropdownTrigger", "orionButton", "commandButton", "launchConfigurationsButton");
            this._boundConfListener = this.gotoConfigFile.bind(this);
            this._configurationBtn.addEventListener("click", this._boundConfListener);

            this._inputChangedListener = this.inputChangedListener.bind(this);
            this._editorInputManager.addEventListener("InputChanged", this._inputChangedListener);

            this._debugSocket = new mDebugSocket.DebugSocket(this._serviceRegistry);
            var debugPanes = this._serviceRegistry.getService("orion.debug.debugPanes");
            debugPanes.connect(this._debugSocket);
            debugPanes.activate(this._debugSocket);
            var boundDebuggerStatusHandler = this.debuggerStatusHandler.bind(this);
            this._debugSocket.addEventListener("status", boundDebuggerStatusHandler);
        } else {
            throw new Error("this._domNode is null");
        }

        deferred.resolve();
        return deferred;
    };

    /**
     * Set current project and update UI
     * @param {Object} - input changed event
     */
    NativeRunBar.prototype.inputChangedListener = function(e) {
        this._projectClient.getProject(e.metadata).then(function(project) {
            this._project = project;
            if (project) {
                this._appName.innerText = project.Name;
                this._appInfo.innerText = 'Debug Configuration';
            } else {
                this._appName.innerText = '';
                this._appInfo.innerText = '';
            }
        }.bind(this));
    };

    /**
     * Handle the status event from the debugger
     * @param {StatusEvent} e
     */
    NativeRunBar.prototype.debuggerStatusHandler = function(e) {
        if (e.status === e.STATUS.RUNNING) {
            this._statusLight.classList.remove('statusLightGreen');
            this._statusLight.classList.remove('statusLightRed');
            this._statusLight.classList.remove('statusLightAmber');
            this._statusLight.classList.add('statusLightGreen');
            this._playButton.classList.add("disabled");
            this._stopButton.classList.remove("disabled");
        } else if (e.status === e.STATUS.PAUSED) {
            this._statusLight.classList.remove('statusLightGreen');
            this._statusLight.classList.remove('statusLightRed');
            this._statusLight.classList.remove('statusLightAmber');
            this._statusLight.classList.add('statusLightRed');
        } else { // IDLE
            this._statusLight.classList.remove('statusLightGreen');
            this._statusLight.classList.remove('statusLightRed');
            this._statusLight.classList.remove('statusLightAmber');
            this._playButton.classList.remove("disabled");
            this._stopButton.classList.add("disabled");
        }
    };

    /**
     * Return the path of config file
     */
    NativeRunBar.prototype.getConfigFilePath = function() {
        return '/file/' + this._project.Name + '/.orion/debug.json';
    };

    /**
     * Go to and edit the debug config file
     */
    NativeRunBar.prototype.gotoConfigFile = function() {
        if (this._project) {
            location.hash = this.getConfigFilePath();
        }
    };

    /**
     * Launch a debug target of the current project
     */
    NativeRunBar.prototype.launchDebugTarget = function() {
        if (this._project) {
            this._fileClient.read(this.getConfigFilePath()).then(function(configText) {
                var config = JSON.parse(configText);
                config.projectName = this._project.Name;
                this._debugSocket.launch(config);
            }.bind(this));
        }
    };

    /**
     * Disconnect a debug target of the current project
     */
    NativeRunBar.prototype.disconnectDebugTarget = function() {
        this._debugSocket.disconnect();
    };

    return {
        RunBar: NativeRunBar
    };
});
