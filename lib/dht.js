'use strict';

exports.__esModule = true;

var _dgram = require('dgram');

var _dgram2 = _interopRequireDefault(_dgram);

var _bencode = require('bencode');

var _bencode2 = _interopRequireDefault(_bencode);

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

var _ktable = require('./ktable');

var _ktable2 = _interopRequireDefault(_ktable);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BOOTSTRAP_NODES = [['router.bittorrent.com', 6881], ['dht.transmissionbt.com', 6881]];
//var BOOTSTRAP_NODES = [['router.bittorrent.com', 6881], ['dht.transmissionbt.com', 6881],['dht.utorrent.com', 6881]];

var TID_LENGTH = 4;
var NODES_MAX_SIZE = 1000;
var TOKEN_LENGTH = 2;

var DHTSpider = function () {
  /**
   * [constructor description]
   * @param  {Object} options [description]
   * @return {[type]}         [description]
   */

  function DHTSpider() {
    var options = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

    _classCallCheck(this, DHTSpider);

    this.btclient = options.btclient;
    this.address = options.address;
    this.port = options.port;
    this.udp = _dgram2.default.createSocket('udp4');
    this.ktable = new _ktable2.default(options.nodesMaxSize || NODES_MAX_SIZE);
    this.bootstrapNodes = options.bootstrapNodes || BOOTSTRAP_NODES;
  }

  DHTSpider.prototype.sendKRPC = function sendKRPC(msg) {
    var rinfo = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

    if (rinfo.port >= 65536 || rinfo.port <= 0) {
      return;
    }
    var buf = _bencode2.default.encode(msg);
    this.udp.send(buf, 0, buf.length, rinfo.port, rinfo.address);
  };

  DHTSpider.prototype.onFindNodeResponse = function onFindNodeResponse(nodes) {
    var _this = this;

    nodes = _utils2.default.decodeNodes(nodes);
    nodes.forEach(function (node) {
      if (node.address !== _this.address && node.nid !== _this.ktable.nid && node.port < 65536 && node.port > 0) {
        _this.ktable.push(node);
      }
    });
  };

  DHTSpider.prototype.sendFindNodeRequest = function sendFindNodeRequest(rinfo, nid) {
    var _nid = nid !== undefined ? _utils2.default.genNeighborID(nid, this.ktable.nid) : this.ktable.nid;
    var msg = {
      t: _utils2.default.randomID().slice(0, TID_LENGTH),
      y: 'q',
      q: 'find_node',
      a: {
        id: _nid,
        target: _utils2.default.randomID()
      }
    };
    this.sendKRPC(msg, rinfo);
  };

  DHTSpider.prototype.joinDHTNetwork = function joinDHTNetwork() {
    var _this2 = this;

    this.bootstrapNodes.forEach(function (node) {
      _this2.sendFindNodeRequest({
        address: node[0],
        port: node[1]
      });
    });
  };

  DHTSpider.prototype.makeNeighbours = function makeNeighbours() {
    var _this3 = this;

    this.ktable.nodes.forEach(function (node) {
      _this3.sendFindNodeRequest({
        address: node.address,
        port: node.port
      }, node.nid);
    });
    this.ktable.nodes = [];
  };

  DHTSpider.prototype.onGetPeersRequest = function onGetPeersRequest(msg, rinfo) {
    var infohash = msg.a.info_hash;
    var tid = msg.t;
    var nid = msg.a.id;
    var token = infohash.slice(0, TOKEN_LENGTH);

    if (tid === undefined || infohash.length !== 20 || nid.length !== 20) {
      return;
    }

    this.sendKRPC({
      t: tid,
      y: 'r',
      r: {
        id: _utils2.default.genNeighborID(infohash, this.ktable.nid),
        nodes: '',
        token: token
      }
    }, rinfo);
  };

  DHTSpider.prototype.onAnnouncePeerRequest = function onAnnouncePeerRequest(msg, rinfo) {
    var port = undefined;

    var infohash = msg.a.info_hash;
    var token = msg.a.token;
    var nid = msg.a.id;
    var tid = msg.t;

    if (tid === undefined) {
      return;
    }

    if (infohash.slice(0, TOKEN_LENGTH).toString() !== token.toString()) {
      return;
    }

    if (msg.a.implied_port !== undefined && msg.a.implied_port !== 0) {
      port = rinfo.port;
    } else {
      port = msg.a.port || 0;
    }

    if (port >= 65536 || port <= 0) {
      return;
    }

    this.sendKRPC({
      t: tid,
      y: 'r',
      r: {
        id: _utils2.default.genNeighborID(nid, this.ktable.nid)
      }
    }, rinfo);

    this.btclient.download({
      address: rinfo.address,
      port: port
    }, infohash);
  };

  DHTSpider.prototype.onMessage = function onMessage(msg, rinfo) {
    try {
      msg = _bencode2.default.decode(msg);
    } catch (e) {
      return;
    }
    var y = msg.y && msg.y.toString();
    var q = msg.q && msg.q.toString();
    if (y === 'r' && msg.r.nodes) {
      this.onFindNodeResponse(msg.r.nodes);
    } else if (y === 'q' && q === 'get_peers') {
      this.onGetPeersRequest(msg, rinfo);
    } else if (y === 'q' && q === 'announce_peer') {
      this.onAnnouncePeerRequest(msg, rinfo);
    }
  };

  DHTSpider.prototype.start = function start() {
    var _this4 = this;

    this.udp.bind(this.port, this.address);

    this.udp.on('listening', function () {
      console.log('udp start listening:', _this4.address, _this4.port);
    });

    this.udp.on('message', function (msg, rinfo) {
      _this4.onMessage(msg, rinfo);
    });

    this.udp.on('error', function (err) {
      console.log('error', err.stack);
    });

    setInterval(function () {
      return _this4.joinDHTNetwork();
    }, 1000);
    setInterval(function () {
      return _this4.makeNeighbours();
    }, 1000);
  };

  DHTSpider.start = function start(options) {
    var instance = new DHTSpider(options);
    instance.start();
  };

  return DHTSpider;
}();

exports.default = DHTSpider;
