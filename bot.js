//      _       _ _        _           _           _   
//   __| | __ _(_) |_   _ (_)___      | |__   ___ | |_ 
//  / _` |/ _` | | | | | || / __|_____| '_ \ / _ \| __|
// | (_| | (_| | | | |_| || \__ \_____| |_) | (_) | |_ 
//  \__,_|\__,_|_|_|\__, |/ |___/     |_.__/ \___/ \__|
//                  |___/__/                           

var irc = require('irc'),
    sys = require('sys'),
    fs = require('fs'),
    settings,
    mongoose = require('mongoose').Mongoose,
    client,
    LinkCatcher,
    settings,
    db,
    Link,
    Message;

try {
  eval(fs.readFileSync('settings.js').toString());
} catch (exception) {
  sys.puts('Please ensure you have a valid settings.js file.');
  process.exit(1);
}

db = mongoose.connect('mongodb://'
  + settings.mongo.server
  + '/'
  + settings.mongo.database);

// DB models
mongoose.model('Link', {
  properties: ['url', 'nick', 'channel', 'server', 'updated_at', 'count'],
  methods: {
    save: function(fn) {
      this.updated_at = new Date();
      this.__super__(fn);
    },

    increment: function() {
      this.count += 1;
      this.save();
    }
  },
  indexes: ['url', [{ url: 1 }, { unique: true }]]
});

mongoose.model('Message', {
  properties: ['message', 'nick', 'channel', 'server', 'updated_at'],
  methods: {
    save: function(fn) {
      this.updated_at = new Date();
      this.__super__(fn);
    }
  }
});

Link = db.model('Link');
Message = db.model('Message');

// Link collections
LinkCatcher = {
  matcher: /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/,

  match: function(text) {
    var matches = text.match(this.matcher);
    if (matches && matches.length > 0) {
      return matches[0];
    }
  }
};

// IRC client
client = new irc.Client(settings.server, 'djsbot', {
    channels: [settings.channel],
});

client.addListener('raw', function(message) {
  sys.puts(message.command + ' '  + message.args.join(','));
});

client.addListener('message', function(from, to, message) {
  (new Message({ message: message,
                 nick: from,
                 channel: to,
                 server: settings.server })).save();

  // TODO: Multiple links
  var url;
  if (url = LinkCatcher.match(message)) {
    Link.find({ url: url }).first(function(link) {
      if (!link) {
        (new Link({ url: url,
                    nick: from,
                    channel: to,
                    count: 1,
                    server: settings.server })).save();
        client.say(settings.channel, 'Saving link: ' + url);
      } else {
        link.increment();
        client.say(settings.channel, 'Seen: ' + url + ' ' + link.count + ' times, posted by: ' + link.nick);
      }
    });
  }
});

