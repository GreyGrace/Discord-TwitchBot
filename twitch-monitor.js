const config = require('./config.json');
const TwitchApi = require('./twitch-api');
const MiniDb = require('./minidb');
const moment = require('moment');

class TwitchMonitor {
    static __init() {
        this._userDb = new MiniDb("twitch-users");
        this._gameDb = new MiniDb("twitch-games");

        this._lastUserRefresh = this._userDb.get("last-update") || null;
        this._pendingUserRefresh = false;
        this._userData = this._userDb.get("user-list") || { };

        this._pendingGameRefresh = false;
        this._gameData = this._gameDb.get("game-list") || { };
        this._watchingGameIds = [];
    }

    static start() {
        // Load channel names from config
        this.channelNames = [];
        config.twitch_channels.split(',').forEach((channelName) => {
            if (channelName) {
                this.channelNames.push(channelName.toLowerCase());
            }
        });
        if (!this.channelNames.length) {
            console.warn('[TwitchMonitor]', 'No channels configured');
            return;
        }

        // Configure polling interval
        let checkIntervalMs = parseInt(config.twitch_check_interval_ms);
        if (isNaN(checkIntervalMs) || checkIntervalMs < TwitchMonitor.MIN_POLL_INTERVAL_MS) {
            // Enforce minimum poll interval to help avoid rate limits
            checkIntervalMs = TwitchMonitor.MIN_POLL_INTERVAL_MS;
        }
        setInterval(() => {
            this.refresh("Actualizacion periodica");
        }, checkIntervalMs + 1000);

        // Immediate refresh after startup
        setTimeout(() => {
            this.refresh("Actualizacion Inicial Start up");
        }, 1000);

        // Ready!
        console.log('[TwitchMonitor]', `Usuarios configurados para stream notification:`, this.channelNames.join(', '),
          `(${checkIntervalMs}ms en intervalo)`);
    }

    static refresh(reason) {
        const now = moment();
        console.log('[Twitch]', ' ▪ ▪ ▪ ▪ ▪ ', `Actualizando (${reason ? reason : "No reason"})`, ' ▪ ▪ ▪ ▪ ▪ ');

        // Refresh all users periodically
        if (this._lastUserRefresh === null || now.diff(moment(this._lastUserRefresh), 'minutos') >= 10) {
            TwitchApi.fetchUsers(this.channelNames)
              .then((users) => {
                  this.handleUserList(users);
              })
              .catch((err) => {
                  console.warn('[TwitchMonitor]', 'Error en actualizar usuarios:', err);
              })
              .then(() => {
                  if (this._pendingUserRefresh) {
                      this._pendingUserRefresh = false;
                  }
              })
        }

        // Refresh all games if needed
        if (this._pendingGameRefresh) {
            TwitchApi.fetchGames(this._watchingGameIds)
              .then((games) => {
                  this.handleGameList(games);
              })
              .catch((err) => {
                  console.warn('[TwitchMonitor]', 'Error en actualizar juegos:', err);
              })
              .then(() => {
                  if (this._pendingGameRefresh) {
                      this._pendingGameRefresh = false;
                  }
              });
        }

        // Refresh all streams
        if (!this._pendingUserRefresh && !this._pendingGameRefresh) {
            TwitchApi.fetchStreams(this.channelNames)
              .then((channels) => {
                  this.handleStreamList(channels);
              })
              .catch((err) => {
                  console.warn('[TwitchMonitor]', 'Error actualizar streams:', err);
              });
        }
    }

    static handleUserList(users) {
        let gotChannelNames = [];

        users.forEach((user) => {
            const channelName = user.login.toLowerCase();

            let prevUserData = this._userData[channelName] || { };
            this._userData[channelName] = Object.assign({ }, prevUserData, user);

            gotChannelNames.push(user.display_name);
        });

        if (gotChannelNames.length) {
            console.debug('[TwitchMonitor]', 'Actualizando informacion de usuario:', gotChannelNames.join(', '));
        }

        this._lastUserRefresh = moment();

        this._userDb.put("last-update", this._lastUserRefresh);
        this._userDb.put("user-list", this._userData);
    }

    static handleGameList(games) {
        let gotGameNames = [];

        games.forEach((game) => {
            const gameId = game.id;

            let prevGameData = this._gameData[gameId] || { };
            this._gameData[gameId] = Object.assign({ }, prevGameData, game);

            gotGameNames.push(`${game.id} → ${game.name}`);
        });

        if (gotGameNames.length) {
            console.debug('[TwitchMonitor]', 'Actualizo informacion de juego:', gotGameNames.join(', '));
        }

        this._lastGameRefresh = moment();

        this._gameDb.put("last-update", this._lastGameRefresh);
        this._gameDb.put("game-list", this._gameData);
    }

    static handleStreamList(streams) {
        // Index channel data & build list of stream IDs now online
        let nextOnlineList = [];
        let nextGameIdList = [];

        streams.forEach((stream) => {
            const channelName = stream.user_name.toLowerCase();

            if (stream.type === "live") {
                nextOnlineList.push(channelName);
            }

            let userDataBase = this._userData[channelName] || { };
            let prevStreamData = this.streamData[channelName] || { };

            this.streamData[channelName] = Object.assign({ }, userDataBase, prevStreamData, stream);
            this.streamData[channelName].game = (stream.game_id && this._gameData[stream.game_id]) || null;

            if (stream.game_id) {
                nextGameIdList.push(stream.game_id);
            }
        });

        // Find channels that are now online, but were not before
        let notifyFailed = false;
        let anyChanges = false;

        for (let i = 0; i < nextOnlineList.length; i++) {
            let _chanName = nextOnlineList[i];

            if (this.activeStreams.indexOf(_chanName) === -1) {
                // Stream was not in the list before
                console.log('[TwitchMonitor]', 'Stream online:', _chanName);
                anyChanges = true;
            }

            if (!this.handleChannelLiveUpdate(this.streamData[_chanName], true)) {
                notifyFailed = true;
            }
        }

        // Find channels that are now offline, but were online before
        for (let i = 0; i < this.activeStreams.length; i++) {
            let _chanName = this.activeStreams[i];

            if (nextOnlineList.indexOf(_chanName) === -1) {
                // Stream was in the list before, but no longer
                console.log('[TwitchMonitor]', 'Stream offline:', _chanName);
                this.streamData[_chanName].type = "detected_offline";
                this.handleChannelOffline(this.streamData[_chanName]);
                anyChanges = true;
            }
        }

        if (!notifyFailed) {
            // Notify OK, update list
            this.activeStreams = nextOnlineList;
        } else {
            console.log('[TwitchMonitor]', 'No se pudo notificar canal, se intentara la siguiente actualizacion.');
        }

        if (!this._watchingGameIds.hasEqualValues(nextGameIdList)) {
            // We need to refresh game info
            this._watchingGameIds = nextGameIdList;
            this._pendingGameRefresh = true;
            this.refresh("Need to request game data");
        }
    }

    static handleChannelLiveUpdate(streamData, isOnline) {
        for (let i = 0; i < this.channelLiveCallbacks.length; i++) {
            let _callback = this.channelLiveCallbacks[i];

            if (_callback) {
                if (_callback(streamData, isOnline) === false) {
                    return false;
                }
            }
        }

        return true;
    }

    static handleChannelOffline(streamData) {
        this.handleChannelLiveUpdate(streamData, false);

        for (let i = 0; i < this.channelOfflineCallbacks.length; i++) {
            let _callback = this.channelOfflineCallbacks[i];

            if (_callback) {
                if (_callback(streamData) === false) {
                    return false;
                }
            }
        }

        return true;
    }

    static onChannelLiveUpdate(callback) {
        this.channelLiveCallbacks.push(callback);
    }

    static onChannelOffline(callback) {
        this.channelOfflineCallbacks.push(callback);
    }
}

TwitchMonitor.activeStreams = [];
TwitchMonitor.streamData = { };

TwitchMonitor.channelLiveCallbacks = [];
TwitchMonitor.channelOfflineCallbacks = [];

TwitchMonitor.MIN_POLL_INTERVAL_MS = 30000;

module.exports = TwitchMonitor;

TwitchMonitor.__init();