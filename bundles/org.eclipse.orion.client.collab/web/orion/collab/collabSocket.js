/* Initializes websocket connection */

define([], function() {
	var hubUrl = "ws://localhost:80/hub/";
	function CollabSocket(sessionid) {
        this.socket = new WebSocket(hubUrl);
	}

	CollabSocket.prototype.constructor = CollabSocket;

	return CollabSocket;
});