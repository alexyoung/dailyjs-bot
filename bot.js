//      _       _ _        _           _           _   
//   __| | __ _(_) |_   _ (_)___      | |__   ___ | |_ 
//  / _` |/ _` | | | | | || / __|_____| '_ \ / _ \| __|
// | (_| | (_| | | | |_| || \__ \_____| |_) | (_) | |_ 
//  \__,_|\__,_|_|_|\__, |/ |___/     |_.__/ \___/ \__|
//                  |___/__/                           

var irc = require('irc'),
    sys = require('sys'),
    fs = require('fs'),
    http = require('http'),
    net = {
      url: require('url'),
    },
    settings,
    mongoose = require('mongoose').Mongoose,
    client,
    LinkCatcher,
    settings,
    db,
    Commands,
    Link,
    Message;

try {
  settings = JSON.parse(fs.readFileSync('settings.js').toString());
} catch (exception) {
  sys.puts('Please ensure you have a valid settings.js file.');
  process.exit(1);
}

db = mongoose.connect(settings.mongo.uri);

// DB models
mongoose.model('Link', {
  properties: ['url', 'title', 'nick', 'channel', 'server', 'updated_at', 'count'],
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
  },

  title: function(urlString, fn) {
    var redirects = 0;

    function get(urlString) {
      if (redirects > 4) return;

      var url = net.url.parse(urlString),
          connection = http.createClient(url.port || 80, url.host, url.protocol === 'https:'),
          request;

      url.pathname = url.pathname || '/';
      url.search = url.search || '';
      request = connection.request('GET', url.pathname + url.search, {
        'host': url.host,
        'Accept-Ranges': '0..2046'
      });

      sys.puts('Fetching: ' + url.host + url.pathname + url.search);
      request.end();
      request.on('response', function(response) {
        var data = '',
            title = '',
            ended = false;

        if (response.statusCode >= 300 && response.statusCode < 400) {
          redirects += 1;
          request.end();
          return get(response.headers.location, request);
        }

        response.on('data', function(chunk) {
          if (ended) return;

          data += chunk;

          if (data.match(/<title>/)) {
            title = data.match(/<title>([^<]*)<\/title>/);
            if (title) {
              fn(title[1]);
              response.socket.end();
              data = null;
              ended = true;
              return;
            }
          }

          // I want to only download x bytes
          if (data.length > 2046) {
            response.socket.end();
            ended = true;
          }
        });
      });
    }

    get(urlString);
  }
};

// IRC commands
Commands = {
  publicCommands: ['search', 'help'],

  match: function(text) {
    for (var i = 0; i < this.publicCommands.length; i++) {
      var command = this.publicCommands[i],
          matches = text.split(new RegExp('^`(' + command + ')\\s+(.*)', 'i'));

      if (matches && matches.length > 1) {
        return { name: matches[1], args: matches[2] };
      }

      matches = text.split(new RegExp('^`(' + command + ')', 'i'));
      if (matches.length > 1) {
        return { name: matches[1], args: null };
      }
    }
  },

  search: function(commandSpec, from, to, message) {
    if (!commandSpec.args) return;

    // I can't get Mongoose to do '$or' for some reason
    Link.find({ title: (new RegExp(commandSpec.args, 'i')) })
        .limit(4)
        .sort('updated_at', 1)
        .all(function(result) {
      result.forEach(function(link) {
        client.say(settings.channel, 'Found link: ' + link.url);
      });

      if (result.length === 0) {
        client.say(settings.channel, 'No matches found');
      }
    });
  },

  help: function(commandSpec, to, from, message) {
    client.say(settings.channel, 'I can only do `search phrase right now because Alex sucks');
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
  var commandSpec;
  if (commandSpec = Commands.match(message)) {
    Commands[commandSpec.name](commandSpec, from, to, message);
  }
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
        link = new Link({ url: url,
                          nick: from,
                          channel: to,
                          count: 1,
                          server: settings.server });
        link.save();
        client.say(settings.channel, 'Saving link: ' + url);
      } else {
        link.increment();
        client.say(settings.channel, 'Seen: ' + url + ' ' + link.count + ' times, posted by: ' + link.nick);
      }
      LinkCatcher.title(url, function(title) {
        link.title = title;
        link.save();
        client.say(settings.channel, 'Title: ' + title);
      });
    });
  }
});

