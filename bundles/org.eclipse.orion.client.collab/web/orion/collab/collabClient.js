/*******************************************************************************
 * @license
 * Copyright (c) 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License v1.0
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html).
 *
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/

/*eslint-env browser, amd */
define(['orion/EventTarget', 'orion/editor/annotations', 'orion/collab/ot', 'orion/webui/treetable'],
	function(EventTarget, mAnnotations, ot, mTreeTable) {

	var AT = mAnnotations.AnnotationType;
	
	// ms to delay updating collaborator annotation.
	// We need this delay because the annotation is updated asynchronizedly and is transferd in multiple
	// packages. We don't want the UI to refresh too frequently.
	var COLLABORATOR_ANNOTATION_UPDATE_DELAY = 500;

	/**
	 * A record of a collaborator
	 * 
	 * @param {string} id -
	 * @param {string} name -
	 * @param {string} color -
	 */
	var CollabPeer = function(id, name, color) {
		this.id = id;
		this.name = name;
		this.color = color;
	};

	/**
	 * A record of a collaborator annotation in the file tree
	 * 
	 * @constructor
	 * @name {orion.collab.CollabFileAnnotation}
	 * @implements {orion.treetable.TableTree.IAnnotation}
	 * 
	 * @param {string} name - username
	 * @param {string} color - user color
	 * @param {string} location - file location
	 */
	var CollabFileAnnotation = function(name, color, location) {
		this.name = name;
		this.color = color;
		// Remove trailing "/"
		if(location.substr(-1) === '/') {
			location = location.substr(0, location.length - 1);
		}
		this.location = location;
	};

	CollabFileAnnotation.prototype = {
		/**
		 * Find the deepest expanded folder item that contains the file having
		 * this annotation.
		 * 
		 * @see IAnnotation for details.
		 * 
		 * @param {orion.explorer.ExplorerModel} model -
		 * @param {Function} callback -
		 */
		findDeepestFitId: function(model, callback) {
			var self = this;
			model.getRoot(function(root) {
				// Find the existing ID reversely
				var location = self.location;
				while (location.length > 0) {
					// Create a fake item
					// NOTE: it's a hack because we don't have any efficient
					//       way to get the actual file node. Instead, we have
					//       to do it recursively starting from the root. As
					//       long as anything wierd happens, change it to the
					//       actual item object.
					var item = {
						Location: location
					};
					var id = model.getId(item);
					// Test if this element exists
					var exists = !!document.getElementById(id);
					if (exists) {
						callback(id);
						return;
					}
					// Not found. This probably means this item is collapsed.
					// Try to find one level upper.
					// Here I assume every url starts from "/"
					location = location.substr(0, location.lastIndexOf('/'));
				}
				// Nothing found
				callback('');
			});
		},

		/**
		 * Get description of this annotation which can be used in for example
		 * tooltip.
		 * 
		 * @return {string} - description
		 */
		getDescription: function() {
			return this.name + ' is editing this file.';
		},

		/**
		 * Generate a new HTML element of this annotation.
		 * 
		 * @return {Element} - the HTML element of this annotation
		 */
		generateHTML: function() {
			var element = document.createElement('div');
			element.innerText = this.name.substr(0, 2);
			element.style.backgroundColor = this.color;
			element.classList.add('collabAnnotation');
			return element;
		}
	};

	var collabSocket = {
		socket: null,
		setSocket: function(websocket) {
			this.socket = websocket;
			if (this.dispatchEvent) {
				this.dispatchEvent({type: "Open"});
			}
		},

		destroySocket: function() {
			this.socket = null;
			if (this.dispatchEvent) {
				this.dispatchEvent({type: "Closed"});
			}
		}
	};
	

	/**
	* As soon as the collabSocket.socket value gets set or unset, a collabClient needs to be notified.
	* So when creating a collabClient, need to have a listener on changes to collabSocket.socket
	*/
	function CollabClient(editor, inputManager, fileClient) {
		this.editor = editor;
		this.inputManager = inputManager;
		this.fileClient = fileClient;
		this.textView = null;
		var self = this;
		this.fileClient.addEventListener('Changed', self.sendFileOperation.bind(self));
		EventTarget.attach(collabSocket);
		this.editor.addEventListener("ModelLoaded", function(event) {self.viewInstalled.call(self, event);});
		this.editor.addEventListener("TextViewUninstalled", function(event) {self.viewUninstalled.call(self, event);});
		this.ot = null;
		this.otOrionAdapter = null;
		this.collabSocket = collabSocket;
		this.collabSocket.addEventListener("Open", self.socketConnected.bind(self));
		this.collabSocket.addEventListener("Closed", self.socketDisconnected.bind(self));
		this.socket = this.collabSocket.socket;
		window.addEventListener("hashchange", function() {self.destroyOT.call(self);});
		this.docPeers = {}; // TODO: combine with this.peers
		this.awaitingClients = false;
		if (this.socket && !this.socket.closed && this.textView) {
			this.initSocket();
		}
		this.collabFileAnnotations = {};
		// Timeout id to indicate whether a delayed update has already been assigned
		this.collabFileAnnotationsUpdateTimeoutId = 0;
		/**
		 * A map of clientid -> peer
		 * This is different from this.docPeers because it is session-wised.
		 * @type {Object.<string, CollabPeer>}
		 */
		this.peers = {}; // TODO: currently there is no way to remove a peer from here
	}

	CollabClient.prototype = {
		initSocket: function() {
			this.inputManager.collabRunning = true;
			var client = this;
			
			//Add the necessary functions to the socket so we can run an OT session.
		  	this.socket.sendOperation = function (revision, operation, selection) {
		  		var myDoc = client.currentDoc();
			    var msg = {
			      'type': 'operation',
			      'revision': revision,
			      'operation': operation,
			      'selection': selection,
			      'doc': myDoc,
			      'clientId': this.clientId
			    };
			    this.send(JSON.stringify(msg));
				client.editor.markClean();
		  	};

		 	this.socket.sendSelection = function (selection) {
		  		var myDoc = client.currentDoc();
			    var msg = {
			      'type': 'selection',
			      'selection': selection,
			      'doc': myDoc,
			      'clientId': this.clientId
			    };
		    	this.send(JSON.stringify(msg));
		  	};

		 	this.socket.registerCallbacks = function (cb) {
		    	this.callbacks = cb;
		  	};

		  	this.socket.trigger = function (event) {
		  		if (!client.textView) return;
			    var args = Array.prototype.slice.call(arguments, 1);
			    var action = this.callbacks && this.callbacks[event];
			    if (action) { action.apply(this, args); }
		  	};

		  	this.socket.docmessage = function(msg) {
				if (msg.doc !== client.currentDoc() || !client.textView) {
		  			return;
		  		}
		        switch(msg.type) {
		          case "init-document":
					client.docPeers = msg.clients;
		            client.startOT(msg.revision, msg.operation, msg.clients);
		            client.awaitingClients = false;
		            break;
		          case "client_left":
		            this.trigger('client_left', msg.clientId);
					delete client.docPeers[msg.clientId];
		            break;
		          case "client_joined":
					client.docPeers[msg.clientId] = msg.client;
					this.trigger('client_joined', msg.clientId, client.docPeers[msg.clientId]);
		          	break;
		          case "all_clients":
					client.docPeers = msg.clients;
					this.trigger('clients', client.docPeers);
					client.awaitingClients = false;
					break;
		          case "client_update":
					this.trigger('client_update', msg.clientId, msg.client);
		          	break;
		          case "ack":
		            this.trigger('ack');
		            break;
		          case "operation":
		            this.trigger('operation', msg.operation);
					client.editor.markClean();
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

			this.socket.on('message', function(msg) {
				switch (msg.type) {
					case 'togetherjs.hello':
						// Listen to the hello message in order to track everyone's current doc.
						// hello message initiates a new sequence of annotations, so it clears
						// all the existing annotations.
						client.resetCollabFildAnnotation();
					case 'togetherjs.hello-back':
						// Both hello and hello-back contains client info (name, color, etc.),
						// so we update the record of this peer
						client.addOrUpdatePeer(new CollabPeer(msg.clientId, msg.name, msg.color));
						// Both hello and hello-back message contains one user's current doc, so
						// we add a new annotation.
						// Use hash to get the location of the current file but remove the leading #
						var location = client.maybeTransformLocation(msg.urlHash.substr(1));
						client.addOrUpdateCollabFileAnnotation(msg.clientId, location);
						break;

					case 'togetherjs.update_client':
						client.addOrUpdatePeer(new CollabPeer(msg.clientId, msg.name, msg.color));
						this.trigger('client_update', msg.clientId, msg);
						break;

					case 'togetherjs.peer-update':
						client.addOrUpdatePeer(new CollabPeer(msg.clientId, msg.peer.name, msg.peer.color));
						this.trigger('client_update', msg.clientId, msg);
						break;
				}
			});
		
			//now let's get this started and request the latest doc.
		    var msg = {
		      'type': 'join-document',
		      'doc': this.currentDoc(),
		      'clientId': this.socket.clientId
		    };

		    this.socket.send(msg);
		},

		/**
		 * Reset the record of collaborator file annotation
		 */
		resetCollabFildAnnotation: function() {
			this.collabFileAnnotations = {};
		},

		/**
		 * Add or update a record of collaborator file annotation and request to update UI
		 * 
		 * @param {string} clientId -
		 * @param {string} name -
		 * @param {string} url -
		 */
		addOrUpdateCollabFileAnnotation: function(clientId, url) {
			var self = this;
			var peer = this.getPeer(clientId);
			// Peer might be loading. Once it is loaded, this annotation will be automatically updated,
			// so we can safely leave it blank.
			var name = peer ? peer.name : '';
			var color = peer ? peer.color : '#000000';
			this.collabFileAnnotations[clientId] = new CollabFileAnnotation(name, color, url);
			if (!this.collabFileAnnotationsUpdateTimeoutId) {
				// No delayed update is assigned. Assign one.
				// This is necessary because we don't want duplicate UI action within a short period.
				this.collabFileAnnotationsUpdateTimeoutId = setTimeout(function() {
					self.collabFileAnnotationsUpdateTimeoutId = 0;
					var annotations = [];
					for (var key in self.collabFileAnnotations) {
						if (self.collabFileAnnotations.hasOwnProperty(key)) {
							annotations.push(self.collabFileAnnotations[key]);
						}
					}
					self.fileClient.dispatchEvent({
						type: 'CollabChanged',
						annotations: annotations
					});
				}, COLLABORATOR_ANNOTATION_UPDATE_DELAY);
			}
		},

		/**
		 * Determine whether a client has a file annotation
		 * 
		 * @return {boolean} -
		 */
		collabHasFileAnnotation: function(clientId) {
			return !!this.collabFileAnnotations[clientId];
		},

		/**
		 * Get the client's file annotation
		 * 
		 * @return {CollabFileAnnotation} -
		 */
		getCollabFileAnnotation: function (clientId) {
			return this.collabFileAnnotations[clientId];
		},

		/**
		 * Add or update peer record
		 * 
		 * @param {CollabPeer} peer -
		 */
		addOrUpdatePeer: function(peer) {
			if (this.peers[peer.id]) {
				// Update
				this.peers[peer.id] = peer;
				if (this.collabHasFileAnnotation(peer.id)) {
					var annotation = this.getCollabFileAnnotation(peer.id);
					this.addOrUpdateCollabFileAnnotation(peer.id, annotation.location);
				}
			} else {
				// Add
				this.peers[peer.id] = peer;
			}
		},

		/**
		 * Get peer by id
		 * 
		 * @return {CollabPeer} -
		 */
		getPeer: function(clientId) {
			return this.peers[clientId];
		},

		startOT: function(revision, operation, clients) {
			if (this.ot) {
				this.otOrionAdapter.detach();
				this.ot = null;
			}
			this.textView.getModel().setText(operation[0], 0);
			this.otOrionAdapter = new ot.OrionAdapter(this.editor, AT);
			this.ot = new ot.EditorClient(revision, clients, this.socket, this.otOrionAdapter, this.socket.clientId);
			this.editor.markClean();
		},

		destroyOT: function() {
			if (this.ot && this.otOrionAdapter) {
				this.otOrionAdapter.detach();
				//reset to regular undo/redo behaviour
				this.editor.getTextActions().init();
				this.ot = null;
				if (this.socket) {
					var msg = {
				      'type': 'leave-document',
				      'clientId': this.socket.clientId
				    };
				    this.socket.send(msg);
				}
			}
		},

		currentDoc: function() {
			var workspace = this.getFileSystemPrefix();
			if (workspace !== '/file/') {
		        //get everything after 'workspace name'
		        return location.hash.substring(location.hash.indexOf(workspace) + workspace.length).split('/').slice(3).join('/');
			} else {
		        return location.hash.substring(location.hash.indexOf(workspace) + workspace.length, location.hash.length);
			}
		},

		getFileSystemPrefix: function() {
			return location.hash.indexOf('/sharedWorkspace') === 1 ? '/sharedWorkspace/tree/file/' : '/file/';
		},

		viewInstalled: function(event) {
			this.docPeers = {};
			var self = this;
			var ruler = this.editor._annotationRuler;
			ruler.addAnnotationType(AT.ANNOTATION_COLLAB_LINE_CHANGED, 1);
			ruler = this.editor._overviewRuler;
			ruler.addAnnotationType(AT.ANNOTATION_COLLAB_LINE_CHANGED, 1);
			this.textView = this.editor.getTextView();

			//hook the collab annotation
			if (this.socket && !this.socket.closed) {
				this.initSocket();
			}
		},

		//Moved to OT.js
		// selectionListener: function(e) {
		// 	if (!this.socket) return;
		// 	var currLine = this.editor.getLineAtOffset(e.newValue.start);
		// 	var lastLine = this.editor.getModel().getLineCount()-1;
		// 	var lineStartOffset = this.editor.getLineStart(currLine);
		// 	var offset = e.newValue.start;

		//     if (offset) {
		//         //decide whether or not it is worth sending (if line has changed or needs updating).
		//         if (currLine !== this.myLine || currLine === lastLine || currLine === 0) {
		//         //if on last line and nothing written, send lastline-1 to bypass no annotation on empty line.
		//             if (currLine === lastLine && offset === lineStartOffset) {
		//                 currLine -= 1;
		//             }
		//         } else {
		//             return;
		//         }
		// 	}

		//     this.myLine = currLine;

		//     this.socket.sendSelection(currLine);
		// },

		viewUninstalled: function(event) {
			this.textView = null;
			this.docPeers = {};
		},

		//Not used anymore
		// initializeLineAnnotations: function() {
		// 	for (var key in this.docPeers)	{
		// 		if (!this.docPeers.hasOwnProperty(key)) continue;
		// 		this.updateLineAnnotation(key, this.docPeers[key].selection);
		// 	}
		// },

		//Moved to OT.js
		// updateLineAnnotation: function(id, line = 0, name = 'unknown', color = '#000000') {
		// 	if (this.docPeers[id]) {
		// 		name = this.docPeers[id].username;
		// 		color = this.docPeers[id].usercolor;
		// 	} else {
		// 		console.log("received selection before client was initialized.");
		// 		//ask for the clients
		// 		if (!this.awaitingClients) {
		// 			this.getDocPeers();
		// 			this.awaitingClients = true;
		// 		}
		// 		return;
		// 	}
		// 	var viewModel = this.editor.getModel();
		// 	var annotationModel = this.editor.getAnnotationModel();
		// 	var lineStart = this.editor.mapOffset(viewModel.getLineStart(line));
		// 	if (lineStart === -1) return;
		// 	var ann = AT.createAnnotation(AT.ANNOTATION_COLLAB_LINE_CHANGED, lineStart, lineStart, name + " is editing");
		// 	ann.html = ann.html.substring(0, ann.html.indexOf('></div>')) + " style='background-color:" + color + "'><b>" + name.substring(0,2) + "</b></div>";
		// 	ann.peerId = id;
		// 	var peerId = id;

		// 	/*if peer isn't being tracked yet, start tracking
		// 	* else replace previous annotation
		// 	*/
		// 	if (!(peerId in this.annotations && this.annotations[peerId]._annotationModel)) {
		// 		this.annotations[peerId] = ann;
		// 		annotationModel.addAnnotation(this.annotations[peerId]);
		// 	} else {
		// 		var currAnn = this.annotations[peerId];
		// 		if (ann.start === currAnn.start) return;
		// 		annotationModel.replaceAnnotations([currAnn], [ann]);
		// 		this.annotations[peerId] = ann;
		// 	}
		// },

		//Moved to OT.js
		// destroyCollabAnnotations: function(peerId) {
		// 	var annotationModel = this.editor.getAnnotationModel();
		// 	var currAnn = null;

		// 	/*If a peer is specified, just remove their annotation
		// 	* Else remove all peers' annotations.
		// 	*/
		// 	if (peerId) {
		// 		if (this.annotations[peerId]) {
		// 			//remove that users annotation
		// 			currAnn = this.annotations[peerId];
		// 			annotationModel.removeAnnotation(currAnn);
		// 			delete this.annotations[peerId];
		// 		}
		// 	} else {
		// 		//the session has ended remove everyone's annotation
		// 		annotationModel.removeAnnotations(AT.ANNOTATION_COLLAB_LINE_CHANGED);
		// 		this.annotations = {};
		// 	}
		// },

		docInstalled: function(event) {
			if (this.socket) {
				this.initSocket();
			}
		},

		socketConnected: function() {
			this.socket = this.collabSocket.socket;
			var self = this;
			this.socket.opmessage = function(msg) {
				/**
				** this was supposed to be doc level messages, but we are now adding session level operations like file_operation.
				** so for now we will temporarily allow it through the following way until the togetherjs session management is replaced.
				*/
				if (msg.type == 'file_operation') {
					self.handleFileOperation(msg);
				}
			};
			this.initSocket();
		},

		socketDisconnected: function() {
			this.socket = null;
			this.inputManager.collabRunning = false;
			this.fileClient.removeEventListener('Changed', this._sendFileOperation);
			this.destroyOT();
		},

		getDocPeers: function() {
		    var msg = {
		      'type': 'get-clients',
		      'doc': this.currentDoc(),
		      'clientId': this.socket.clientId
		    };
		    this.socket.send(msg);
		},

		sendFileOperation: function(evt) {
			if (!this.socket) return;
			if (!this.ignoreNextFileOperation) {
				var operation = evt.created ? 'created' : evt.moved ? 'moved' : evt.deleted ? 'deleted' : evt.copied ? 'copied' : '';
				if (operation) {
				    var msg = {
						'type': 'file_operation',
						'operation': operation,
						'data': evt[operation],
						'clientId': this.socket.clientId
				    };
				    this.socket.send(msg);
				}
			}
			this.ignoreNextFileOperation = false;
		},

		handleFileOperation: function(msg) {
			if (!this.ignoreNextFileOperation) {
				var evt = this.makeFileClientEvent(msg.operation, msg.data);
				this.dispatchFileClientEvent(evt);
			}
			this.ignoreNextFileOperation = false;
		},

		makeFileClientEvent: function(operation, data) {
			/**
			** we can't trigger the event directly since the user might be on a seperate file system.
			*/
			data = data[0];
			var evt = {
				type: "Changed"
			};

			var evtData = {'select': false};

			switch (operation) {
				case 'created':
					var parentLocation = this.maybeTransformLocation(data.parent);
					var result = data.result;
					result.Parents = []; //is parents even needed for this operation?
					result.Location = this.maybeTransformLocation(result.Location);
					evt.created = [{'parent': parentLocation, 'result': result, 'eventData': evtData}];
					break;
				case 'deleted':
					var deleteLocation = this.maybeTransformLocation(data.deleteLocation);
					evt.deleted = [{'deleteLocation': deleteLocation, 'eventData': evtData}];
					break;
				case 'moved':
					var sourceLocation = this.maybeTransformLocation(data.source);
					var targetLocation = this.maybeTransformLocation(data.target);
					var result = data.result;
					result.Parents = []; //is parents even needed for this operation?
					result.Location = this.maybeTransformLocation(result.Location);
					evt.moved = [{'source': sourceLocation, 'target': targetLocation, 'result': result, 'eventData': evtData}];
					break;
				case 'copied':
					var sourceLocation = this.maybeTransformLocation(data.source);
					var targetLocation = this.maybeTransformLocation(data.target);
					var result = data.result;
					result.Parents = []; //is parents even needed for this operation?
					result.Location = this.maybeTransformLocation(result.Location);
					evt.copied = [{'source': sourceLocation, 'target': targetLocation, 'result': result, 'eventData': evtData}];
					break;
			}

			return evt;
		},

		/**
		** For example we potentially need to convert a '/file/web/potato.js' to '/sharedWorkspace/tree/file/web/potato.js'
		** and vice-versa, depending on our file system and the sender's filesystem.
		**/
		maybeTransformLocation: function(Location) {
			var loc = this.getFileSystemPrefix();
			//if in same workspace
			if (Location.indexOf(loc) === 0) {
				return Location;
			} else {
				var oppositeLoc = loc == '/file/' ? '/sharedWorkspace/tree/file/' : '/file/';
				//we need to replace sharedWorkspace... with /file and vice versa.
				// we also need to replace workspace info for shared workspace or add it when its not the case.
				var file = Location.substring(oppositeLoc.length);
				if (loc == '/file/') {
					//since the received location includes workspace info, swap that out.
					file = file.split('/').slice(3).join('/');
				} else {
					//since you need to workspace info, add that in.
					var projectLoc = location.hash.substring(location.hash.indexOf(loc) + loc.length);
					projectLoc = projectLoc.split('/').slice(0,3).join('/') + '/';
					file = projectLoc + file;
				}
				Location = loc + file;
				return Location;
			}
		},

		dispatchFileClientEvent: function(evt) {
			this.ignoreNextFileOperation = true;
			this.fileClient.dispatchEvent(evt);
		}
	};

	CollabClient.prototype.constructor = CollabClient;

	return {
		collabClient: CollabClient,
		collabSocket: collabSocket
	};
});
