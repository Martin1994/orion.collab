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
    'orion/Deferred'
], function(Deferred) {

    'use strict'

    /**
     * Provides a simple implementation of hover evaluation.
     * 
     * This is a very simple implementation that evaluates a "possible" word at
     * the current cursor position. Ideally, language plugins should parse the
     * source code, and evaluate the deepest node in the abstract syntax tree
     * that contains this character.
     * 
     * Examples that this simple implementation doesn't work:
     *     C++:
     *         x->property
     * 
     *     JavaScript:
     *         x.property
     * 
     *     Lisp:
     *         (map x empty?)
     * 
     * Examples that an ideal implementation should work:
     *     Javascript:
     *         x ? y : z
     *         should evaluate (x ? y : z) when hovering on "?"
     *         should evaluate y when hovering on "y"
     * 
     * @class {orion.debug.DebugHover}
     * 
     * @param {orion.serviceregistry.ServiceRegistry} serviceRegistry
     * @param {orion.debug.DebugSocket} debugSocket
     */
    var DebugHover = function(serviceRegistry, debugSocket) {
        this._debugSocket = debugSocket;
        serviceRegistry.registerService("orion.edit.hover", this, {
			name: 'Hover Evaluation',
			contentType: ["application/javascript", "text/x-c++src", "text/x-python"]
        });
    };

    /**
     * Evaluate the hover
     * @param {Object} editorContext
     * @param {Object} ctxt
     * @return {string}
     */
    DebugHover.prototype.computeHoverInfo = function(editorContext, ctxt) {
        var that = this;
        var deferred = new Deferred();
        editorContext.getText().then(function(content) {
            var toEvaluate = that._findPossibleWord(content, ctxt.offset);
            if (toEvaluate) {
                that._debugSocket.evaluate(toEvaluate, 'hover', function(result) {
                    deferred.resolve(result ? result.result : null);
                });
            } else {
                deferred.resolve(null);
            }
        });
        return deferred;
    };

    /**
     * All characters that split words
     */
    DebugHover.prototype.DELIMITER_REGEX = /^[-!$%^&*()+|~=`{}\[\]:";'<>?,.\/\s]$/;

    /**
     * Find the possible word to evaluate
     * @private
     * @param {string} content
     * @param {number} position
     * @return {string}
     */
    DebugHover.prototype._findPossibleWord = function(content, position) {
        // Find start
        var start = position;
        while (start >= 0 && !content.charAt(start).match(this.DELIMITER_REGEX)) {
            start--;
        }
        start ++;

        // Find end
        var end = position;
        while (end < content.length && !content.charAt(end).match(this.DELIMITER_REGEX)) {
            end++;
        }
        if (start >= end) {
            return null;
        } else {
            return content.substr(start, end - start);
        }
    };

    return {
        DebugHover: DebugHover
    };

});
