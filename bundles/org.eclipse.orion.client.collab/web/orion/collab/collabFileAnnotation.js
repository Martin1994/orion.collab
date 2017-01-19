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
define([], function() {

    'use strict';

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
					//       to do it recursively starting from the root. If
					//       you find anything wierd happens, change it to the
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

    return {
		CollabFileAnnotation: CollabFileAnnotation
	};
});