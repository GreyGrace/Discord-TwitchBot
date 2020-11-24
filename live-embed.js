const Discord = require('discord.js');
const moment = require('moment');
const humanizeDuration = require("humanize-duration");
const config = require('./config.json');

class LiveEmbed {
  static createForStream(streamData) {
    const isLive = streamData.type === "live";
    const allowBoxArt = config.twitch_use_boxart;

    let msgEmbed = new Discord.MessageEmbed();
    msgEmbed.setColor(isLive ? "#9146ff" : "GREY");
    msgEmbed.setURL(`https://twitch.tv/${streamData.user_name.toLowerCase()}`);

    let thumbUrl = streamData.profile_image_url;

    if (allowBoxArt && streamData.game && streamData.game.box_art_url) {
      thumbUrl = streamData.game.box_art_url;
      thumbUrl = thumbUrl.replace("{width}", "288");
      thumbUrl = thumbUrl.replace("{height}", "384");
    }

    msgEmbed.setThumbnail(thumbUrl);

    if (isLive) {
      // Titulo
      msgEmbed.setTitle(`:red_circle: **${streamData.user_name} esta en vivo en Twitch**`);
      msgEmbed.addField("Titulo", streamData.title, false);
    } else {
      msgEmbed.setTitle(`:white_circle: ${streamData.user_name} a terminado su stream en Twitch`);
      msgEmbed.setDescription('Se termino el stream');

      msgEmbed.addField("Titulo", streamData.title, true);
    }

    // Juego
    if (streamData.game) {
      msgEmbed.addField("Juego", streamData.game.name, false);
    }

    if (isLive) {
      // Estatus
      msgEmbed.addField("Status", isLive ? `En vivo ${streamData.viewer_count} espectadores` : 'Offline', true);

      // Imagen
      let imageUrl = streamData.thumbnail_url;
      imageUrl = imageUrl.replace("{width}", "1280");
      imageUrl = imageUrl.replace("{height}", "720");
      let thumbnailBuster = (Date.now() / 1000).toFixed(0);
      imageUrl += `?t=${thumbnailBuster}`;
      msgEmbed.setImage(imageUrl);

      // Duracion
      let now = moment();
      let startedAt = moment(streamData.started_at);

      msgEmbed.addField("Duracion", humanizeDuration(now - startedAt, {
        delimiter: ", ",
        largest: 2,
        round: true,
        units: ["y", "mo", "w", "d", "h", "m"]
      }), true);
    }

    return msgEmbed;
  }
}

module.exports = LiveEmbed;