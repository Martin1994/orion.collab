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

/*eslint-env browser, amd */
define(['orion/collab/collabPeer', 'orion/collab/ot'], function(mCollabPeer, ot) {

    'use strict';

    var CollabPeer = mCollabPeer.CollabPeer;
    var TextOperation = ot.TextOperation;
    var Selection = ot.Selection;

    /**
     * The socket adapter for OT using togetherjs as communitation socket
     *
     * @class
     * @name orion.collab.OrionTogetherJSAdapter
     *
     * @param {orion.collabClient.CollabClient} client -
     * @param {TogetherJS.Channel} socket -
     */
    var OrionTogetherJSAdapter = function(client, socket) {
        var self = this;

        this.client = client;
        this.socket = socket;
        this.callbacks = [];

        // Register incoming message handler
        this.socket.on('message', function(msg) {
            self._onMessage(msg);
        });
    };

    OrionTogetherJSAdapter.prototype.constructor = OrionTogetherJSAdapter;
    
    /**
     * Send authenticate message
     */
    OrionTogetherJSAdapter.prototype.authenticate = function() {
        var msg = {
            'type': 'authenticate',
            'token': localStorage.getItem('orionSocket.authToken'),
            'clientId': this.client.getClientId()
        };
        this.send(JSON.stringify(msg));
    };

    /**
     * Send text
     *
     * @param {string} text -
     */
    OrionTogetherJSAdapter.prototype.send = function(text) {
        this.socket.send(text);
    };

    /**
     * Message handler
     *
     * @param {string} msg -
     */
    OrionTogetherJSAdapter.prototype._onMessage = function(msg) {
        if (msg.doc) {
            this._onDocMessage(msg);
        } else {
            this._onSessionMessage(msg);
        }
    };

    /**
     * Document Message handler
     *
     * @param {string} msg -
     */
    OrionTogetherJSAdapter.prototype._onDocMessage = function(msg) {
        if (msg.doc !== this.client.currentDoc() || !this.client.textView) {
            return;
        }
        var type = msg.type;
        if (type.substr(0, 11) === 'togetherjs.') {
            type = type.substr(11);
        }
        switch(type) {
            case "init-document":
                // Initialize
                for (var clientId in msg.clients) {
                    if (msg.clients.hasOwnProperty(clientId)) {
                        var peerData = msg.clients[clientId];
                        this.client.addOrUpdatePeer(new CollabPeer(clientId, peerData.name, peerData.color));
                    }
                }
                this.client.startOT(msg.revision, msg.operation, msg.clients);
                this.client.awaitingClients = false;
                break;
            case "client_left":
                this.trigger('client_left', msg.clientId);
                this.client.removePeer(msg.clientId);
                break;
            case "client_joined":
                this.client.addOrUpdatePeer(new CollabPeer(msg.clientId, msg.client.username, msg.client.color));
                this.trigger('client_joined', msg.clientId, this.client.getPeer(clientId));
                break;
            case "all_clients":
                for (var clientId in msg.clients) {
                    if (msg.clients.hasOwnProperty(clientId)) {
                        var peerData = msg.clients[clientId];
                        this.client.addOrUpdatePeer(new CollabPeer(clientId, peerData.name, peerData.color));
                    }
                }
                this.trigger('clients', msg.clients);
                this.client.awaitingClients = false;
                break;
            case "client_update":
                this.trigger('client_update', msg.clientId, msg.client);
                break;
            case "ack":
                this.trigger('ack');
                break;
            case "operation":
                this.trigger('operation', msg.operation);
                this.client.editor.markClean();
                this.trigger('selection', msg.clientId, msg.selection);
                break;
            case "selection":
                this.trigger('selection', msg.clientId, msg.selection);
                break;
            case "reconnect":
                this.trigger('reconnect');
                break;
        }
    };

    /**
     * Session Message handler
     *
     * @param {string} msg -
     */
    OrionTogetherJSAdapter.prototype._onSessionMessage = function(msg) {
        var type = msg.type;
        if (type.substr(0, 11) === 'togetherjs.') {
            type = type.substr(11);
        }
        switch (type) {
            case 'authenticated':
                this.sendInit();
                this.client.getDocPeers();
                // Re-send hello because TogetherJS might sent hello before this client
                // is authenticated.
			    var session = TogetherJS.require('session');
                session.sayHello();
                break;

            case 'hello':
                // Listen to the hello message in order to track everyone's current doc.
                // hello message initiates a new sequence of annotations, so it clears
                // all the existing annotations.
                this.client.resetCollabFildAnnotation();
            case 'hello-back':
                // Both hello and hello-back contains client info (name, color, etc.),
                // so we update the record of this peer
                this.client.addOrUpdatePeer(new CollabPeer(msg.clientId, msg.name, msg.color));
                // Both hello and hello-back message contains one user's current doc, so
                // we add a new annotation.
                // Use hash to get the location of the current file but remove the leading #
                var location = this.client.maybeTransformLocation(msg.urlHash.substr(1));
                this.client.addOrUpdateCollabFileAnnotation(msg.clientId, location);
                break;

            case 'update_client':
                this.client.addOrUpdatePeer(new CollabPeer(msg.clientId, msg.name, msg.color));
                this.trigger('client_update', msg.clientId, msg);
                break;

            case 'peer-update':
                this.client.addOrUpdatePeer(new CollabPeer(msg.clientId, msg.peer.name, msg.peer.color));
                this.trigger('client_update', msg.clientId, msg);
                break;

            case 'file_operation':
                this.client.handleFileOperation(msg);
                break;
        }
    };

    /**
     * Send the initial message
     */
    OrionTogetherJSAdapter.prototype.sendInit = function() {
        var msg = {
            'type': 'join-document',
            'doc': this.client.currentDoc(),
            'clientId': this.client.getClientId()
        };

        this.send(JSON.stringify(msg));
    }

    /**
     * Send OT operation
     * @param {number} revision -
     * @param {OT.Operation} operation -
     * @param {OT.Selection} selection -
     */
    OrionTogetherJSAdapter.prototype.sendOperation = function(revision, operation, selection) {
        var myDoc = this.client.currentDoc();
        var msg = {
            'type': 'operation',
            'revision': revision,
            'operation': operation,
            'selection': selection,
            'doc': myDoc,
            'clientId': this.client.getClientId()
        };
        this.send(JSON.stringify(msg));
        this.client.editor.markClean();
    };

    /**
     * Send OT selection
     * @param {OT.Selection} selection -
     */
    OrionTogetherJSAdapter.prototype.sendSelection = function (selection) {
        var myDoc = this.client.currentDoc();
        var msg = {
            'type': 'selection',
            'selection': selection,
            'doc': myDoc,
            'clientId': this.client.getClientId()
        };
        this.send(JSON.stringify(msg));
    };

    /**
     * Register callbacks.
     * We won't use EventTarget because OT uses registerCallbacks/trigger to
     * perform event operations.
     *
     * @param {Object.<string, (Function|Array.<Function>)>} cb - callbacks
     */
    OrionTogetherJSAdapter.prototype.registerCallbacks = function (cb) {
        this.callbacks = cb;
    };

    /**
     * Trigger an event.
     *
     * @param {Object} event -
     */
    OrionTogetherJSAdapter.prototype.trigger = function (event) {
        if (!this.client.textView) return;
        var args = Array.prototype.slice.call(arguments, 1);
        var action = this.callbacks && this.callbacks[event];
        if (action) { action.apply(this, args); }
    };

    /**
     * The socket adapter for OT using togetherjs as communitation socket but
     * all IO actions are delayed
     *
     * Test usage only!
     * 
     * @class
     * @name orion.collab.OrionTogetherJSDelayAdapter
     * @extends orion.collab.OrionTogetherJSAdapter
     *
     * @param {orion.collabClient.CollabClient} client -
     * @param {TogetherJS.Channel} socket -
     * @param {number} delay - ms to delay. Note that both sending and receiving
     *     actions are delayed so the actual lag is doubled.
     */
    var OrionTogetherJSDelayAdapter = function(client, socket, delay) {
        OrionTogetherJSAdapter.apply(this, arguments);
        this.delay = delay;
    };

    OrionTogetherJSDelayAdapter.prototype = Object.create(OrionTogetherJSAdapter.prototype);
    OrionTogetherJSDelayAdapter.prototype.constructor = OrionTogetherJSDelayAdapter;

    /**
     * Send text with delay
     *
     * @param {string} text -
     */
    OrionTogetherJSDelayAdapter.prototype.send = function(text) {
        var self = this;
        setTimeout(function() {
            if (self.socket.socket) {
                OrionTogetherJSAdapter.prototype.send.call(self, text);
            }
        }, this.delay);
    };

    /**
     * Message handler with delay
     *
     * @param {string} msg -
     */
    OrionTogetherJSDelayAdapter.prototype._onMessage = function(msg) {
        var self = this;
        setTimeout(function() {
            if (self.socket.socket) {
                OrionTogetherJSAdapter.prototype._onMessage.call(self, msg);
            }
        }, this.delay);
    };

    var OrionEditorAdapter = function (orion, collabClient, annotationTypes) {
        this.editor = orion;
        this.orion = orion.getTextView();
        this.model = orion.getModel();
        this.ignoreNextChange = false;
        this.changeInProgress = false;
        this.selectionChanged = false;
        this.myLine = 0;
        this.deleteContent = "";
        this.AT = annotationTypes;
        this.annotations = {};
        this.collabClient = collabClient;

        this.destroyCollabAnnotations();

        this._onChanging = this.onChanging.bind(this);
        this._onChanged = this.onChanged.bind(this);
        this._onCursorActivity = this.onCursorActivity.bind(this);
        this._onFocus = this.onFocus.bind(this);
        this._onBlur = this.onBlur.bind(this);
        this._selectionListener = this.selectionListener.bind(this);

        this.orion.addEventListener('ModelChanging', this._onChanging);
        this.orion.addEventListener('ModelChanged', this._onChanged);
        this.orion.addEventListener('cursorActivity', this._onCursorActivity);
        this.orion.addEventListener('focus', this._onFocus);
        this.orion.addEventListener('blur', this._onBlur);
        this.orion.addEventListener('Selection', this._selectionListener);

        // Give initial cursor position
        var cursor = this.editor.getSelection().start;
        this.myLine = this.editor.getLineAtOffset(cursor);
    }

    // Removes all event listeners from the Orion instance.
    OrionEditorAdapter.prototype.detach = function () {
        this.orion.removeEventListener('ModelChanging', this._onChanging);
        this.orion.removeEventListener('ModelChanged', this._onChanged);
        this.orion.removeEventListener('cursorActivity', this._onCursorActivity);
        this.orion.removeEventListener('focus', this._onFocus);
        this.orion.removeEventListener('blur', this._onBlur);
        this.orion.removeEventListener('Selection', this._selectionListener);
    };

    function OrionDocLength (doc) {
        return doc.getModel().getCharCount();
    }

    // Converts a Orion change array (as obtained from the 'changes' event
    // in Orion v4) or single change or linked list of changes (as returned
    // by the 'change' event in Orion prior to version 4) into a
    // TextOperation and its inverse and returns them as a two-element array.
    OrionEditorAdapter.operationFromOrionChanges = function (changes, doc, deletedText) {
        // Approach: Replay the changes, beginning with the most recent one, and
        // construct the operation and its inverse. We have to convert the position
        // in the pre-change coordinate system to an index. We have a method to
        // convert a position in the coordinate system after all changes to an index,
        // namely Orion's `indexFromPos` method. We can use the information of
        // a single change object to convert a post-change coordinate system to a
        // pre-change coordinate system. We can now proceed inductively to get a
        // pre-change coordinate system for all changes in the linked list.
        // A disadvantage of this approach is its complexity `O(n^2)` in the length
        // of the linked list of changes.

        var docEndLength = OrionDocLength(doc) - changes[0].addedCharCount + changes[0].removedCharCount;
        var operation    = new TextOperation().retain(docEndLength);
        var inverse      = new TextOperation().retain(docEndLength);

        for (var i = changes.length - 1; i >= 0; i--) {
            var change = changes[i];

            var fromIndex = change.start;
            var restLength = docEndLength - fromIndex - change.removedCharCount;

            operation = operation.compose(new TextOperation()
                .retain(fromIndex)
                ['delete'](change.removedCharCount)
                .insert(change.text)
                .retain(restLength)
            );

            if (change.addedCharCount && change.removedCharCount) {
            //REPLACE ACTION
            inverse = new TextOperation()
                .retain(fromIndex)
                ['delete'](change.addedCharCount)
                .insert(deletedText)
                .retain(restLength)
                .compose(inverse);
            } else if (change.addedCharCount) {
            //INSERT ACTION
            inverse = new TextOperation()
                .retain(fromIndex)
                ['delete'](change.addedCharCount)
                .retain(restLength)
                .compose(inverse);
            } else {
            //DELETE ACTION
            inverse = new TextOperation()
                .retain(fromIndex)
                .insert(deletedText)
                .retain(restLength)
                .compose(inverse);
            }

            docEndLength += change.removedCharCount - change.text.length;
        }

        return [operation, inverse];
    };

    // Singular form for backwards compatibility.
    OrionEditorAdapter.operationFromOrionChange =
        OrionEditorAdapter.operationFromOrionChanges;

    // Apply an operation to a Orion instance.
    OrionEditorAdapter.applyOperationToOrion = function (operation, orion) {
        var ops = operation.ops;
        var index = 0; // holds the current index into Orion's content
        for (var i = 0, l = ops.length; i < l; i++) {
            var op = ops[i];
            if (TextOperation.isRetain(op)) {
                index += op;
            } else if (TextOperation.isInsert(op)) {
                orion.setText(op, index, i < (ops.length - 1) ? index : undefined);
                index += op.length;
            } else if (TextOperation.isDelete(op)) {
                var from = index;
                var to   = index - op;
                orion.setText('', from, to);
            }
        }
    };

    OrionEditorAdapter.prototype.registerCallbacks = function (cb) {
        this.callbacks = cb;
    };

    OrionEditorAdapter.prototype.onChanging = function (change) {
        // By default, Orion's event order is the following:
        // 1. 'ModelChanging', 2. 'ModelChanged'
        // We want to fire save the deleted/replaced text during a 'modelChanging' event if applicable,
        // so that we can use it to create the reverse operation used for the undo-stack after the model has changed.
        if (change.removedCharCount > 0) {
            this.deleteContent = this.orion.getText(change.start, change.start + change.removedCharCount);
        }

        this.changeInProgress = true;
    };

    OrionEditorAdapter.prototype.onChanged = function (change) {
        this.changeInProgress = true;
        if (!this.ignoreNextChange) {
            var pair = OrionEditorAdapter.operationFromOrionChanges([change], this.orion, this.deleteContent);
            this.trigger('change', pair[0], pair[1]);
        }
        this.deleteContent = "";
        if (this.selectionChanged) { this.trigger('selectionChange'); }
        this.changeInProgress = false;
        // this.ignoreNextChange = false;
    };

    OrionEditorAdapter.prototype.onCursorActivity =
    OrionEditorAdapter.prototype.onFocus = function () {
        if (this.changeInProgress) {
            this.selectionChanged = true;
        } else {
            this.trigger('selectionChange');
        }
    };

    OrionEditorAdapter.prototype.onBlur = function () {
        if (!this.orion.somethingSelected()) { this.trigger('blur'); }
    };

    OrionEditorAdapter.prototype.getValue = function () {
        return this.orion.getText();
    };

    OrionEditorAdapter.prototype.getSelection = function () {
        return new ot.Selection.createCursor(this.myLine);
    };

    OrionEditorAdapter.prototype.setSelection = function (selection) {
      // var ranges = [];
      // for (var i = 0; i < selection.ranges.length; i++) {
      //   var range = selection.ranges[i];
      //   ranges[i] = {
      //     anchor: this.orion.posFromIndex(range.anchor),
      //     head:   this.orion.posFromIndex(range.head)
      //   };
      // }
      // this.orion.setSelections(ranges);
    };

    var addStyleRule = (function () {
        var added = {};
        var styleElement = document.createElement('style');
        document.documentElement.getElementsByTagName('head')[0].appendChild(styleElement);
        var styleSheet = styleElement.sheet;

        return function (css) {
            if (added[css]) { return; }
            added[css] = true;
            styleSheet.insertRule(css, (styleSheet.cssRules || styleSheet.rules).length);
        };
    }());

    OrionEditorAdapter.prototype.selectionListener = function(e) {
        var currLine = this.editor.getLineAtOffset(e.newValue.start);
        var lastLine = this.editor.getModel().getLineCount()-1;
        var lineStartOffset = this.editor.getLineStart(currLine);
        var offset = e.newValue.start;

        if (offset) {
            //decide whether or not it is worth sending (if line has changed or needs updating).
            if (currLine !== this.myLine || currLine === lastLine || currLine === 0) {
                // Send this change
            } else {
                return;
            }
        }

        this.myLine = currLine;

        if (this.changeInProgress) {
            this.selectionChanged = true;
        } else {
            this.trigger('selectionChange');
        }
    };

    OrionEditorAdapter.prototype.setOtherSelection = function (selection, color, clientId) {
        var peer = this.collabClient.getPeer(clientId);
        var name = peer ? peer.name : undefined;
        color = peer ? peer.color : color;
        this.updateLineAnnotation(clientId, selection, name, color);
        var self = this;
        return {
            clear: function() {
                self.destroyCollabAnnotations(clientId);
            }
        };
    };

    OrionEditorAdapter.prototype.updateLineAnnotation = function(id, selection, name, color, force) {
        force = !!force;
        if (id === this.collabClient.getClientId()) {
            // Don't add self
            return;
        }
        name = name || 'Unknown';
        color = color || '#000000';
        var line = selection.ranges[0].head || 0;
        var viewModel = this.editor.getModel();
        var annotationModel = this.editor.getAnnotationModel();
        var lineStart = this.editor.mapOffset(viewModel.getLineStart(line));
        if (lineStart === -1) return;
        var ann = this.AT.createAnnotation(this.AT.ANNOTATION_COLLAB_LINE_CHANGED, lineStart, lineStart, name + " is editing");
        ann.html = ann.html.substring(0, ann.html.indexOf('></div>')) + " style='background-color:" + color + "'><b>" + name.substring(0,2) + "</b></div>";
        ann.peerId = id;
        var peerId = id;

        /*if peer isn't being tracked yet, start tracking
        * else replace previous annotation
        */
        if (!(peerId in this.annotations && this.annotations[peerId]._annotationModel)) {
            this.annotations[peerId] = ann;
            annotationModel.addAnnotation(this.annotations[peerId]);
        } else {
            var currAnn = this.annotations[peerId];
            if (!force && ann.start === currAnn.start) return;
            annotationModel.replaceAnnotations([currAnn], [ann]);
            this.annotations[peerId] = ann;
        }
    };

    /**
     * Update the line annotation of a peer without change its line number
     * i.e. only updates name and color
     * @param {string} id - clientId
     */
    OrionEditorAdapter.prototype.updateLineAnnotationStyle = function(id) {
        var peer = this.collabClient.getPeer(id);
        var name = peer ? peer.name : undefined;
        var color = peer ? peer.color : undefined;
        var annotation = this.annotations[id];
        if (!annotation) {
            return;
        }
        var cursor = annotation.start;
        var selection = ot.Selection.createCursor(cursor);
        this.updateLineAnnotation(id, selection, name, color, true);
    };

    OrionEditorAdapter.prototype.destroyCollabAnnotations = function(peerId) {
      var annotationModel = this.editor.getAnnotationModel();
      var currAnn = null;

      /*If a peer is specified, just remove their annotation
      * Else remove all peers' annotations.
      */
      if (peerId) {
        if (this.annotations[peerId]) {
          //remove that users annotation
          currAnn = this.annotations[peerId];
          annotationModel.removeAnnotation(currAnn);
          delete this.annotations[peerId];
        }
      } else {
        //the session has ended remove everyone's annotation
        annotationModel.removeAnnotations(this.AT.ANNOTATION_COLLAB_LINE_CHANGED);
        this.annotations = {};
      }
    };

    OrionEditorAdapter.prototype.trigger = function (event) {
      var args = Array.prototype.slice.call(arguments, 1);
      var action = this.callbacks && this.callbacks[event];
      if (action) { action.apply(this, args); }
    };

    OrionEditorAdapter.prototype.applyOperation = function (operation) {
      this.ignoreNextChange = true;
      OrionEditorAdapter.applyOperationToOrion(operation, this.model);
      this.ignoreNextChange = false;
    };

    OrionEditorAdapter.prototype.registerUndo = function (undoFn) {
      // this.orion.undo = undoFn;
      this.orion.setAction("undo", undoFn);
    };

    OrionEditorAdapter.prototype.registerRedo = function (redoFn) {
      // this.orion.redo = redoFn;
      this.orion.setAction("redo", redoFn);
    };

    function OrionSocketAdapter (socket) {
      this.socket = socket;

      var self = this;
      socket.onmessage = function(event) {
        var msg = JSON.parse(event.data);

        switch(msg.type) {
          case "client_left":
            self.trigger('client_left', msg.clientId);
            break;
          case "set_name":
            self.trigger('set_name', msg.clientId, msg.name);
            break;
          case "ack":
            self.trigger('ack');
            break;
          case "operation":
            self.trigger('operation', msg.operation);
            self.trigger('selection', msg.clientId, msg.selection);
            break;
          case "selection":
            self.trigger('selection', clientId, selection);
            break;
          case "reconnect":
            self.trigger('reconnect');
            break;
        }
      }
    };

    OrionSocketAdapter.prototype.sendOperation = function (revision, operation, selection) {
      var msg = {
        'type': 'operation',
        'revision': revision,
        'operation': operation,
        'selection': selection
      };
      this.socket.send(JSON.stringify(msg));
    };

    OrionSocketAdapter.prototype.sendSelection = function (selection) {
        var msg = {
        'type': 'selection',
        'selection': selection
      };
      this.socket.send(JSON.stringify(msg));
    };

    OrionSocketAdapter.prototype.registerCallbacks = function (cb) {
      this.callbacks = cb;
    };

    OrionSocketAdapter.prototype.trigger = function (event) {
      var args = Array.prototype.slice.call(arguments, 1);
      var action = this.callbacks && this.callbacks[event];
      if (action) { action.apply(this, args); }
    };

    return {
        OrionTogetherJSAdapter: OrionTogetherJSAdapter,
        OrionTogetherJSDelayAdapter: OrionTogetherJSDelayAdapter,
        OrionSocketAdapter: OrionSocketAdapter,
        OrionEditorAdapter, OrionEditorAdapter
    };
});