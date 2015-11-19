var express = require('express')
	app = express()
	server = require('http').createServer(app)
	path = require('path')
	io = require('socket.io').listen(server)
	bodyParser = require('body-parser')
	Client = require('ftp')
	fs = require('fs')
	mkdirp = require('mkdirp')
	watch = require('watch')
	sass = require('node-sass')
	open = require('open')
	browserSync = require("browser-sync").create();


var running = false, // Are we running a project yet
	reloadingBrowsers = false, // Does browserSync is enable?
	project, // Our project data (similar as form inputs)
	ftp, // FTP instance
	watchers = []; // Collection of watch's monitors

app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));

// Sending static files
app.get('/', function(req, res) {
	res.sendFile(path.join(__dirname, 'public/index.html'));
});
app.get('/app.js', function(req, res) {
	res.sendFile(path.join(__dirname, 'public/app.js'));
});
app.get('/success.png', function(req, res) {
	res.sendFile(path.join(__dirname, 'public/success.png'));
});

// Debug Logger, sending messages/informations through socket.io
var logger = {
	socket: null,
	init: function() {
		io.sockets.on('connection', function(socket) {
			logger.socket = socket;
		});
	},
	error : function() {
		console.log('[error]', arguments);
		logger.emit('warning', arguments);
	},
	success : function() {
		console.log('[success]', arguments);
		logger.emit('success', arguments);
	},
	information : function() {
		console.log('[information]', arguments);
		logger.emit('info', arguments);
	},
	notify : function(message, icon, title) {
		if(!logger.socket)
			return;

		title = title || 'PreProd Watch';

		logger.socket.emit('notify', {title: title, message: message, icon: icon});
	},
	log: function() {
		logger.information(arguments);
	},
	clog: function() {
		console.log(arguments);
	},
	emit: function(type, msg) {
		if(!logger.socket)
			return;

		if(msg.constructor !== Array)
			msg = [msg];

		msg.forEach(function(ms) {
			if(ms.constructor == Array)
				logger.emit(type, ms);
			
			else logger.socket.emit('log', {type: type, message: ms});
		});
	}
};

logger.init();

// On form submit (post/watch)
app.post('/watch', function(req, res) {
	logger.log('Nouveau projet');

	// Store form's input in our project object, using it elsewhere
	project = req.body;

	// If FTP, browserSync or watch are already runing (second form submission), stopping them
	if(ftp)
		ftp.end();

	if(browserSync && browserSync.active)
		browserSync.exit();

	if(watchers && watchers.length) {
		watchers.forEach(function(monitor, i) {
			monitor.stop();

			if(i == watchers.length)
				watchers = [];
		});
	}

	// Connecting to FTP -> Retrieve project's files
	ftp = new Client();
	ftp.on('ready', function() {
		logger.success('Connexion au FTP établie avec succès');

		// We create our project directory (tmp/{login})
		var projectDirectory = path.join(__dirname, 'tmp/'+req.body.login);
		mkdirp(projectDirectory, function(err) {
			if(err) {
				logger.error('Impossible de creer le repertoire du projet', projectDirectory);
				return false;
			}

			logger.information('Repertoire du projet cree, telechargement des ressources en cours');
			ftpDownloadDirectory(ftp, project.directory, projectDirectory, function(err) {
				// When all ressources has been loaded

				logger.success('Téléchargement des ressources terminé');
				logger.information('Vous pouvez maintenant modifier les fichiers du projet, ils seront automatiquement compilés et mis en ligne.');

				// Opening local directory
				if(project.auto_open)
					open(projectDirectory);

				// Sending brower additional informations
				logger.socket.emit('recap', {el:'local_repo', val:projectDirectory});

				// Init browserify and open local URL
				browserSync.init({
					proxy: req.body.proxy,
					open: project.auto_open ? 'local' : false
				}, function(err, bs) {
					logger.socket.emit('recap', {el:'hot_reload_local', val:bs.options.getIn(["urls", "local"])});
					logger.socket.emit('recap', {el:'hot_reload_global', val:bs.options.getIn(["urls", "external"])});
					logger.socket.emit('recap', {el:'hot_reload_ui', val:bs.options.getIn(["urls", "ui"])});
				});

				// Loading files's watchers
		    	loadWatch(projectDirectory, ftp);
			}, true);
		})
	});

	ftpConnect();

	res.charset = res.charset || 'utf-8';
	res.get('Content-Type') || res.set('Content-Type', 'application/json');

	return res.send('{result:ok}');
});

// FTP connection, in a separate method to be use where we need it
function ftpConnect() {
	ftp.connect({host:project.host, user:project.login, password:project.password});
}

// Listening connexions
logger.log('Server listening: localhost:3000');
server.listen('3000');
open('http://localhost:3000/');

// Creating file's watchers
function loadWatch(projectDirectory, ftp) {
	var sassDirectory = path.join(projectDirectory, 'sass');
	var cssDirectory = projectDirectory;

	console.log('loadWatch');

	// For SASS files -> CSS Compilation
	watch.createMonitor(sassDirectory, function (monitor) {
		console.log('createMonitor SCSS');
	    monitor.files['*.scss'];
	    monitor.on("changed", function (f, curr, prev) {
	    	var filename = f.split('\\').pop();

	        ftp.put(f, project.directory+'sass/'+filename, function(err) {
				if (err) {
					return logger.error(err);
				}
		    });

	        // If it's a include (eg _variables.scss), we trigger the change on the layout.css file
	        // @todo find a way to compile all files including this one
	    	if(filename[0] == '_') {
	    		console.log('Modification d\'un fichier inclut ('+filename+')');
	    		filename = 'layout.scss';
	    	}

	    	var cssFilename = filename.replace('scss', 'css');
	    	var cssFilePath = path.join(cssDirectory, cssFilename);

	    	logger.information('Fichier '+filename+' modifié');
	      	sass.render({
	      		file: f
	      	}, function(err, result) {
	      		if(err) {
	      			return logger.error(err);
	      		}

	      		// Writing file into CSS Path
	      		// Trigerring the css's file change event
	      		fs.writeFile(cssFilePath, result.css, function(err){
			        if(err) {
			        	logger.error(err);
			        }

			        logger.success('Fichier '+cssFilePath+' écrit avec succès');
			    });
	      	})
	    });

	    // Adding the monitor to the watcher's collection to destroy it on reload
	    watchers.push(monitor);
  	});

	// CSS Files -> on changes, we upload them
	// @todo, add a on("remove") to delete the remote file
	watch.createMonitor(cssDirectory, function (monitor) {
		console.log('createMonitor CSS');
	    monitor.files['*.css'];
	    monitor.on("changed", function (f, curr, prev) {
	    	var filename = f.split('\\').pop();

	    	// If the file is an include, or isn't CSS, don't upload it
	    	if(filename[0] == '_' || filename.split('.').pop() !== 'css')
	    		return console.log('Modification d\'un fichier non CSS ('+filename+')');

	    	// Sending file
	    	console.log('CSS changed', f);
	        ftp.put(f, project.directory+filename, function(err) {
				if (err) {
					return logger.error(err);
				}

				logger.notify(filename+' compilé et mis en ligne', 'success');
				logger.success('Fichier uploadé avec succès');

				// Ask BrowserSync to refresh all the browsers connected
				// Trying not to refresh in sequence
				reloadingBrowsers = true;
				setTimeout(function() {
					if(!reloadingBrowsers)
						return;

					browserSync.reload();
					reloadingBrowsers = false;
				}, 300);
		    });
	    });

	    watchers.push(monitor);
  	});
}

// Recursive download of a FTP directory
function ftpDownloadDirectory(ftp, dir, dest, callback, mayUpload) {
	console.log('ftpDownloadDirectory', dir)
	dest = dest || path.join(__dirname, 'tmp');

	var filepath;
	var files = [];
	var downloadingDirectories = 0;
	var filesDownloaded = 0;

	var end = function() {
		var file = files.shift();

		if(!file)
		{
			if(files.length <= 0 && downloadingDirectories <= 0)
				return callback();

			return;
		}

		logger.socket.emit('recap', {el:'ressources', val:filesDownloaded+'/'+files.length});
		ftp.get(file.remote_path, function(err, stream) {
			if (err) {
				logger.error(err); 
				return false;
			}

			console.log('writing', file.local_path);
			filesDownloaded++;
			logger.socket.emit('recap', {el:'ressources', val:filesDownloaded+'/'+files.length});
			stream.pipe(fs.createWriteStream(file.local_path));
			
			if(files.length <= 0 && downloadingDirectories <= 0)
				callback();
			else end();
		});
	}

	ftp.list(dir, function(error, list) {
		if(error) {
			logger.error(error);
			return false;
		}
		else {
			var file;
			list.forEach(function(file) {
				if(file.name !== '.' && file.name !== '..' && file.name !== '.sass-cache')
				{
					filepath = path.join(dir, file.name).split('\\').join('/');
					if(file.type == 'd') {
						downloadingDirectories++;
						mkdirp(path.join(dest, file.name), function(err) {
							if(err) {
								downloadingDirectories--;
								logger.error(err);
							}
							else {
								var subfiles = ftpDownloadDirectory(ftp, filepath, path.join(dest, file.name), function(subFiles) {
									downloadingDirectories--;
									if(subFiles && subFiles.length) {
										for(var subFileI in subFiles)
											files.push(subFiles[subFileI]);

										end();
									}
									else {
										end();
									}
								}, false);
							}
						});
					}
					else {
						files.push({
							remote_path: filepath,
							local_path: path.join(dest, file.name)
						});
					}
				}
			});
			
			end();
		}

		if(files.length && !mayUpload)
			return files;
	});
}