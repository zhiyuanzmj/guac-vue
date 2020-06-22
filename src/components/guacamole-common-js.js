import Guacamole from 'guacamole-common-js'
import io from 'socket.io-client';
Guacamole.socketIOTunnel = function(url) {
    /**
     * Reference to this WebSocket tunnel.
     * @private
     */
    var tunnel = this;

    /**
     * The WebSocket used by this tunnel.
     * @private
     */
    var socket = null;

    /**
     * The current receive timeout ID, if any.
     * @private
     */
    var receive_timeout = null;

    /**
     * The current connection stability timeout ID, if any.
     *
     * @private
     * @type {Number}
     */
    var unstableTimeout = null;

    /**
     * The current connection stability test ping interval ID, if any. This
     * will only be set upon successful connection.
     *
     * @private
     * @type {Number}
     */
    var pingInterval = null;

    /**
     * The number of milliseconds to wait between connection stability test
     * pings.
     *
     * @private
     * @constant
     * @type {Number}
     */
    var PING_FREQUENCY = 500;

    /**
     * Initiates a timeout which, if data is not received, causes the tunnel
     * to close with an error.
     * 
     * @private
     */
    function reset_timeout() {

        // Get rid of old timeouts (if any)
        window.clearTimeout(receive_timeout);
        window.clearTimeout(unstableTimeout);

        // Clear unstable status
        if (tunnel.state === Guacamole.Tunnel.State.UNSTABLE)
            tunnel.setState(Guacamole.Tunnel.State.OPEN);

        // Set new timeout for tracking overall connection timeout
        receive_timeout = window.setTimeout(function () {
            close_tunnel(new Guacamole.Status(Guacamole.Status.Code.UPSTREAM_TIMEOUT, "Server timeout."));
        }, tunnel.receiveTimeout);

        // Set new timeout for tracking suspected connection instability
        unstableTimeout = window.setTimeout(function() {
            tunnel.setState(Guacamole.Tunnel.State.UNSTABLE);
        }, tunnel.unstableThreshold);

    }

    /**
     * Closes this tunnel, signaling the given status and corresponding
     * message, which will be sent to the onerror handler if the status is
     * an error status.
     * 
     * @private
     * @param {Guacamole.Status} status The status causing the connection to
     *                                  close;
     */
    function close_tunnel(status) {

        // Get rid of old timeouts (if any)
        window.clearTimeout(receive_timeout);
        window.clearTimeout(unstableTimeout);

        // Cease connection test pings
        window.clearInterval(pingInterval);

        // Ignore if already closed
        if (tunnel.state === Guacamole.Tunnel.State.CLOSED)
            return;

        // If connection closed abnormally, signal error.
        if (status.code !== Guacamole.Status.Code.SUCCESS && tunnel.onerror)
            tunnel.onerror(status);

        // Mark as closed
        tunnel.setState(Guacamole.Tunnel.State.CLOSED);

        socket.close();

    }

    this.sendMessage = function() {
        window.sendMessage=this.sendMessage.bind(this)
        // Do not attempt to send messages if not connected
        if (!tunnel.isConnected())
            return;

        // Do not attempt to send empty messages
        if (arguments.length === 0)
            return;

        /**
         * Converts the given value to a length/string pair for use as an
         * element in a Guacamole instruction.
         * 
         * @private
         * @param value The value to convert.
         * @return {String} The converted value. 
         */
        function getElement(value) {
            var string = new String(value);
            return string.length + "." + string; 
        }

        // Initialized message with first element
        var message = getElement(arguments[0]);

        // Append remaining elements
        for (var i=1; i<arguments.length; i++)
            message += "," + getElement(arguments[i]);

        // Final terminator
        message += ";";

        socket.send(message);

    };

    this.connect = function(query) {

        reset_timeout();
        // Mark the tunnel as connecting
        tunnel.setState(Guacamole.Tunnel.State.CONNECTING);

        // Connect socket
        socket = io(url,{query});
        // socket = io('ws://www.zmjs.cf:7001/',{query:{type:'ssh',hostname:'zmjs.cf',username:'root',password:'Zmj791264830'}});
        
        socket.on('connect',()=>{
            window.console.log(socket.id);
            reset_timeout();
            // Ping tunnel endpoint regularly to test connection stability
            pingInterval = setInterval(function sendPing() {
              tunnel.sendMessage(Guacamole.Tunnel.INTERNAL_DATA_OPCODE,
                  "ping", new Date().getTime());
            }, PING_FREQUENCY);
        })

        socket.on('',(reason)=> {
            // Pull status code directly from closure reason provided by Guacamole
            window.console.log(reason,'....')
            alert(reason)
            if (reason)
                close_tunnel(new Guacamole.Status(parseInt(reason), reason));

            // Failing that, derive a Guacamole status code from the WebSocket
            // status code provided by the browser
            // else if (code)
            //     close_tunnel(new Guacamole.Status(Guacamole.Status.Code.fromWebSocketCode(code)));

            // Otherwise, assume server is unreachable
            else
                close_tunnel(new Guacamole.Status(Guacamole.Status.Code.UPSTREAM_NOT_FOUND));

        });
        
        socket.on('message',(data) =>{
            reset_timeout();

            var message = data;
            var startIndex = 0;
            var elementEnd;

            var elements = [];

            do {

                // Search for end of length
                var lengthEnd = message.indexOf(".", startIndex);
                if (lengthEnd !== -1) {

                    // Parse length
                    var length = parseInt(message.substring(elementEnd+1, lengthEnd));

                    // Calculate start of element
                    startIndex = lengthEnd + 1;

                    // Calculate location of element terminator
                    elementEnd = startIndex + length;

                }
                
                // If no period, incomplete instruction.
                else
                    close_tunnel(new Guacamole.Status(Guacamole.Status.Code.SERVER_ERROR, "Incomplete instruction."));

                // We now have enough data for the element. Parse.
                var element = message.substring(startIndex, elementEnd);
                var terminator = message.substring(elementEnd, elementEnd+1);

                // Add element to array
                elements.push(element);

                // If last element, handle instruction
                if (terminator === ";") {

                    // Get opcode
                    var opcode = elements.shift();

                    // Update state and UUID when first instruction received
                    if (tunnel.uuid === null) {

                        // Associate tunnel UUID if received
                        if (opcode === Guacamole.Tunnel.INTERNAL_DATA_OPCODE)
                            tunnel.uuid = elements[0];

                        // Tunnel is now open and UUID is available
                        tunnel.setState(Guacamole.Tunnel.State.OPEN);

                    }

                    // Call instruction handler.
                    if (opcode !== Guacamole.Tunnel.INTERNAL_DATA_OPCODE && tunnel.oninstruction)
                        tunnel.oninstruction(opcode, elements);

                    // Clear elements
                    elements.length = 0;

                }

                // Start searching for length at character after
                // element terminator
                startIndex = elementEnd + 1;

            } while (startIndex < message.length);

        });

    };

    this.disconnect = function() {
        close_tunnel(new Guacamole.Status(Guacamole.Status.Code.SUCCESS, "Manually closed."));
    };

};

Guacamole.socketIOTunnel.prototype = new Guacamole.Tunnel();

export default Guacamole