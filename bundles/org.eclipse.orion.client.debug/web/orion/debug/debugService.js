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
    'orion/EventTarget',
    'orion/debug/breakpoint'
], function(EventTarget, mBreakpoint) {

    'use strict'

    /**
     * A debug service provides breakpoints, watches and highlighted lines management.
     * Here management means loading and saving data from storage, apis of getters and setters, and correspoding events.
     * Note that breakpoints from streaming (remote-only) files won't be presisted.
     * 
     * @class {orion.debug.DebugService}
     * @param {orion.serviceregistry.ServiceRegistry} serviceRegistry
     */
    var DebugService = function(serviceRegistry) {
        EventTarget.attach(this);

        /**
         * @type {string}
         * @private
         */
        this._focusedFile = undefined;
        /**
         * @type {number}
         * @private
         */
        this._focusedLine = undefined;

        /**
         * @type {Object.<string, Array.<orion.debug.IBreakpoint>>}
         * @private
         */
        this._breakpointsByLocation = {};

        /**
         * @type {Array.<orion.debug.IBreakpoint>}
         * @private
         */
        this._globalBreakpoints = [];

        /**
         * The set of watches.
         * @type {Object.<string, boolean>}
         * @private
         */
        this._watches = {};

        this._loadFromStorage();

        serviceRegistry.registerService("orion.debug.service", this);
    };

    /**
     * Load breakpoints and watches from storage
     * @private
     */
    DebugService.prototype._loadFromStorage = function() {
        // Load beakpoints
        var breakpoints = this._getBreakpointsFromStorage();
        for (var location in breakpoints) {
            if (breakpoints.hasOwnProperty(location)) {
                var docBreakpoints = this._breakpointsByLocation[location] = [];
                if (Array.isArray(breakpoints[location])) {
                    breakpoints[location].forEach(function(serializedBreakpoint) {
                        var breakpoint = mBreakpoint.deserialize(serializedBreakpoint);
                        if (breakpoint) {
                            docBreakpoints.push(breakpoint);
                        }
                    });
                }
            }
        }

        // Load breakpoints without location property
        var nlbreakpoints = this._getGlobalBreakpointsFromStorage();
        for (var i = 0; i < nlbreakpoints.length; i++) {
            var nlbreakpoint = mBreakpoint.deserialize(nlbreakpoints[i]);
            if (nlbreakpoint) {
                this._globalBreakpoints.push(nlbreakpoint);
            }
        }

        // Load watches
        this._watches = this._getWatchesFromStorage();
    };

    /**
     * Get the serialized breakpoints from storage
     * @private
     * @return {Object.<string, Array.<Object>>}
     */
    DebugService.prototype._getBreakpointsFromStorage = function() {
        var storageText = localStorage.getItem('orion.debug.breakpoints');
        try {
            return JSON.parse(storageText) || {};
        } catch(ex) {
            if (storageText) {
                console.error('Invalid breakpoints storage.');
            } else {
                this._setBreakpointsToStorage({});
            }
            return {};
        }
    };

    /**
     * Set the serialized breakpoints to storage
     * @param {Object.<string, Array.<Object>>} breakpoints
     */
    DebugService.prototype._setBreakpointsToStorage = function(breakpoints) {
        localStorage.setItem('orion.debug.breakpoints', JSON.stringify(breakpoints));
    };

    /**
     * Get the serialized breakpoints without location property from storage
     * @private
     * @return {Array.<Object>}
     */
    DebugService.prototype._getGlobalBreakpointsFromStorage = function() {
        var storageText = localStorage.getItem('orion.debug.NLbreakpoints');
        try {
            return JSON.parse(storageText) || [];
        } catch(ex) {
            if (storageText) {
                console.error('Invalid non-location breakpoints storage.');
            } else {
                this._setGlobalBreakpointsToStorage([]);
            }
            return [];
        }
    };

    /**
     * Set the serialized breakpoints without location property to storage
     * @param {Array.<Object>} breakpoints
     */
    DebugService.prototype._setGlobalBreakpointsToStorage = function(breakpoints) {
        localStorage.setItem('orion.debug.NLbreakpoints', JSON.stringify(breakpoints));
    };

    /**
     * Get the list fo watches from storage
     * @private
     * @return {Object.<string, boolean>}
     */
    DebugService.prototype._getWatchesFromStorage = function() {
        var watchListText = localStorage.getItem('orion.debug.watches');
        try {
            var watchList = JSON.parse(watchListText);
            var watches = {};
            watchList.forEach(function (watch) {
                watches[watch] = true;
            });
            return watches;
        } catch(ex) {
            if (watchListText) {
                console.error('Invalid watches storage.');
            } else {
                this._setWatchesToStorage({});
            }
            return {};
        }
    };

    /**
     * Get the list fo watches from storage
     * @private
     * @param {Object.<string, boolean>} watches
     */
    DebugService.prototype._setWatchesToStorage = function(watches) {
        localStorage.setItem('orion.debug.watches', JSON.stringify(Object.keys(watches)));
    };

    /**
     * Add a breakpoint
     * @param {orion.debug.IBreakpoint} breakpoint
     */
    DebugService.prototype.addBreakpoint = function(breakpoint) {
        this._updateBreakpoint(breakpoint);

        this.dispatchEvent({
            type: 'BreakpointAdded',
            breakpoint: breakpoint
        });
    };

    /**
     * Remove a breakpoint
     * @param {orion.debug.IBreakpoint} breakpoint
     */
    DebugService.prototype.removeBreakpoint = function(breakpoint) {
        var compareString = breakpoint.getCompareString();
        if (!this._breakpointsByLocation[breakpoint.location]) {
            this._breakpointsByLocation[breakpoint.location] = [];
        }
        var docBreakpoints = this._breakpointsByLocation[breakpoint.location];
        for (var i = docBreakpoints.length - 1; i >= 0; i--) {
            if (docBreakpoints[i].getCompareString() === compareString) {
                docBreakpoints.splice(i, 1);
            }
        }

        // Also update localstorage
        var serializedBreakpoint = breakpoint.serialize();
        var breakpoints = this._getBreakpointsFromStorage();
        if (!breakpoints[breakpoint.location]) {
            breakpoints[breakpoint.location] = [];
        }
        var docSerializedBreakpoints = breakpoints[breakpoint.location];
        for (var i = docSerializedBreakpoints.length - 1; i >= 0; i--) {
            if (mBreakpoint.deserialize(docSerializedBreakpoints[i]).getCompareString() === compareString) {
                docSerializedBreakpoints.splice(i, 1);
            }
        }
        this._setBreakpointsToStorage(breakpoints);

        this.dispatchEvent({
            type: 'BreakpointRemoved',
            breakpoint: breakpoint
        });
    };

    /**
     * Enable a breakpoint
     * @param {orion.debug.IBreakpoint} breakpoint - the "enabled" property will be ignored
     */
    DebugService.prototype.enableBreakpoint = function(breakpoint) {
        // Make a clone
        breakpoint = mBreakpoint.deserialize(breakpoint.serialize());
        if (!breakpoint.hasOwnProperty('enabled')) {
            return;
        }
        breakpoint.enabled = true;

        this._updateBreakpoint(breakpoint);

        this.dispatchEvent({
            type: 'BreakpointEnabled',
            breakpoint: breakpoint
        });
    };

    /**
     * Disable a breakpoint
     * @param {orion.debug.IBreakpoint} breakpoint - the "enabled" property will be ignored
     */
    DebugService.prototype.disableBreakpoint = function(breakpoint) {
        // Make a clone
        breakpoint = mBreakpoint.deserialize(breakpoint.serialize());
        if (!breakpoint.hasOwnProperty('enabled')) {
            return;
        }
        breakpoint.enabled = false;

        this._updateBreakpoint(breakpoint);

        this.dispatchEvent({
            type: 'BreakpointDisabled',
            breakpoint: breakpoint
        });
    };

    /**
     * Update a breakpoint both locally and in storage
     * @private
     * @param {orion.debug.IBreakpoint} breakpoint - the "enabled" property will be ignored
     */
    DebugService.prototype._updateBreakpoint = function(breakpoint) {
        var compareString = breakpoint.getCompareString();

        // Breakpoints with location and the ones without location should be stored at different places
        if (breakpoint.location) {
            // Delete existing breakpoints
            if (!this._breakpointsByLocation[breakpoint.location]) {
                this._breakpointsByLocation[breakpoint.location] = [];
            }
            var docBreakpoints = this._breakpointsByLocation[breakpoint.location];
            for (var i = docBreakpoints.length - 1; i >= 0; i--) {
                if (docBreakpoints[i].getCompareString() === compareString) {
                    docBreakpoints.splice(i, 1);
                }
            }
            // Add a new one
            this._breakpointsByLocation[breakpoint.location].push(breakpoint);

            // Also update storage
            var breakpoints = this._getBreakpointsFromStorage();
            if (!breakpoints[breakpoint.location]) {
                breakpoints[breakpoint.location] = [];
            }
            // Delete existing breakpoints
            var docSerializedBreakpoints = breakpoints[breakpoint.location];
            for (var i = docSerializedBreakpoints.length - 1; i >= 0; i--) {
                if (mBreakpoint.deserialize(docSerializedBreakpoints[i]).getCompareString() === compareString) {
                    docSerializedBreakpoints.splice(i, 1);
                }
            }
            // Add a new one
            docSerializedBreakpoints.push(breakpoint.serialize());
            // Store
            this._setBreakpointsToStorage(breakpoints);
        } else {
            // Delete existing breakpoints
            for (var i = this._globalBreakpoints.length - 1; i >= 0; i--) {
                if (this._globalBreakpoints[i].getCompareString() === compareString) {
                    this._globalBreakpoints.splice(i, 1);
                }
            }
            // Add a new one
            this._globalBreakpoints.push(breakpoint);

            // Update storage
            var breakpoints = this._getGlobalBreakpointsFromStorage();
            // Delete exsiting breakpoints
            for (var i = breakpoints.length - 1; i >= 0; i--) {
                if (mBreakpoint.deserialize(breakpoints[i]).getCompareString() === compareString) {
                    breakpoints.splice(i, 1);
                }
            }
            // Add a new one
            breakpoints.push(breakpoint.serialize());
            // Store
            this._setGlobalBreakpointsToStorage(breakpoints);
        }
    };

    /**
     * Get breakpoints by document location
     * @param {string} location
     * @return {Array.<orion.debug.IBreakpoint>}
     */
    DebugService.prototype.getBreakpointsByLocation = function(location) {
        if (this._breakpointsByLocation[location]) {
            return this._breakpointsByLocation[location].slice();
        } else {
            return [];
        }
    };

    /**
     * Get breakpoints by document location prefix
     * @param {string} prefix
     * @return {Object.<string, Array.<orion.debug.IBreakpoint>>}
     */
    DebugService.prototype.getBreakpointsByPrefix = function(prefix) {
        var breakpointSets = {};
        for (var location in this._breakpointsByLocation) {
            if (this._breakpointsByLocation.hasOwnProperty(location)) {
                if (location.startsWith(prefix)) {
                    breakpointSets[location] = this._breakpointsByLocation[location];
                }
            }
        }
        return breakpointSets;
    };

    /**
     * Get all breakpoints
     * @return {Array.<orion.debug.IBreakpoint>}
     */
    DebugService.prototype.getBreakpoints = function() {
        var breakpointSets = [];
        for (var location in this._breakpointsByLocation) {
            if (this._breakpointsByLocation.hasOwnProperty(location)) {
                breakpointSets.push(this._breakpointsByLocation[location]);
            }
        }
        return Array.prototype.concat.apply([], breakpointSets);
    };

    /**
     * Get breakpoints that doesn't have location property (e.g. exception breakpoints)
     * @return {Array.<orion.debug.IBreakpoint>}
     */
    DebugService.prototype.getGlobalBreakpoints = function() {
        return this._globalBreakpoints.slice();
    };

    /**
     * Add a watch
     * @param watch {string}
     */
    DebugService.prototype.addWatch = function(watch) {
        this._watches[watch] = true;

        // Store it
        var storedWatches = this._getWatchesFromStorage();
        if (!storedWatches[watch]) {
            storedWatches[watch] = true;
            this._setWatchesToStorage(storedWatches);
        }
        
        this.dispatchEvent({
            type: 'WatchAdded',
            watch: watch
        });
    };

    /**
     * Add a watch
     * @param watch {string}
     */
    DebugService.prototype.removeWatch = function(watch) {
        if (this._watches[watch]) {
            delete this._watches[watch];
        }

        // Store it
        var storedWatches = this._getWatchesFromStorage();
        if (storedWatches[watch]) {
            delete storedWatches[watch];
            this._setWatchesToStorage(storedWatches);
        }

        this.dispatchEvent({
            type: 'WatchRemoved',
            watch: watch
        });
    };

    /**
     * Get all watches
     * @return {Array.<string>}
     */
    DebugService.prototype.getWatches = function() {
        return Object.keys(this._watches);
    };

    /**
     * Focus this line in the editor. There is at most one line to be focused,
     * so any consequencecalls will override this call.
     * @param {string} location
     * @param {number} line
     */
    DebugService.prototype.focusLine = function(location, line) {
        this._focusedFile = location;
        this._focusedLine = line;
        this.dispatchEvent({
            type: 'LineFocused',
            location: location,
            line: line
        });
    };

    /**
     * Unfocus the focused line (if available).
     */
    DebugService.prototype.unfocusLine = function() {
        this._focusedFile = undefined;
        this._focusedLine = undefined;
        this.dispatchEvent({
            type: 'LineUnfocused'
        });
    };

    /**
     * Get the currently focused line and its location
     * @return {Object}
     */
    DebugService.prototype.getFocusedLine = function() {
        if (this._focusedFile) {
            return {
                location: this._focusedFile,
                line: this._focusedLine
            };
        } else {
            return null;
        }
    };

    return {
        DebugService: DebugService
    };

});
