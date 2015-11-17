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


var running = false,
	reloadingBrowsers = false,
	project,
	ftp,
	watchers = [];

app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));

app.get('/', function(req, res) {
	res.sendFile(path.join(__dirname, 'public/index.html'));
});
app.get('/app.js', function(req, res) {
	res.sendFile(path.join(__dirname, 'public/app.js'));
});
app.get('/success.png', function(req, res) {
	res.sendFile(path.join(__dirname, 'public/success.png'));
});


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

app.post('/watch', function(req, res) {
	logger.log('Nouveau projet');

	project = req.body;

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

	ftp = new Client();
	ftp.on('ready', function() {
		logger.success('Connexion au FTP établie avec succès');

		var projectDirectory = path.join(__dirname, 'tmp/'+req.body.login);
		mkdirp(projectDirectory, function(err) {
			if(err) {
				logger.error('Impossible de creer le repertoire du projet', projectDirectory);
				return false;
			}

			logger.information('Repertoire du projet cree, telechargement des ressources en cours');
			ftpDownloadDirectory(ftp, project.directory, projectDirectory, function(err) {
			    setTimeout(function() {
			    	if(running)
			    		return;

					running = true;

					logger.success('Téléchargement des ressources terminé');
					logger.information('Vous pouvez maintenant modifier les fichiers du projet, ils seront automatiquement compilés et mis en ligne.');

					// Ouverture du repertoire local
					if(project.auto_open)
						open(projectDirectory);

					logger.socket.emit('recap', {el:'local_repo', val:projectDirectory});

					// Ouverture de la copie browserify
					browserSync.init({
						proxy: req.body.proxy,
						open: project.auto_open ? 'local' : false
					}, function(err, bs) {
						logger.socket.emit('recap', {el:'hot_reload_local', val:bs.options.getIn(["urls", "local"])});
						logger.socket.emit('recap', {el:'hot_reload_global', val:bs.options.getIn(["urls", "external"])});
						logger.socket.emit('recap', {el:'hot_reload_ui', val:bs.options.getIn(["urls", "ui"])});
					});

			    	loadWatch(projectDirectory, ftp);
			    }, 3000);
			}, true);
		})
	});

	ftpConnect();

	res.charset = res.charset || 'utf-8';
	res.get('Content-Type') || res.set('Content-Type', 'application/json');

	return res.send('{result:ok}');
});


function ftpConnect() {
	ftp.connect({host:project.host, user:project.login, password:project.password});
}


logger.log('Server listening: localhost:3000');
server.listen('3000');

function loadWatch(projectDirectory, ftp) {
	var sassDirectory = path.join(projectDirectory, 'sass');
	var cssDirectory = projectDirectory;

	console.log('loadWatch');

	// Surveillance des fichiers SASS -> Compilation CSS
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

	      		console.log('sass write');
	      		fs.writeFile(cssFilePath, result.css, function(err){
			        if(err) {
			        	logger.error(err);
			        }

			        logger.success('Fichier '+cssFilePath+' écrit avec succès');
			    });
	      	})
	    });
	    watchers.push(monitor);
  	});

	// Surveillance des fichiers CSS -> upload
	watch.createMonitor(cssDirectory, function (monitor) {
		console.log('createMonitor CSS');
	    monitor.files['*.css'];
	    monitor.on("changed", function (f, curr, prev) {
	    	var filename = f.split('\\').pop();

	    	if(filename[0] == '_' || filename.split('.').pop() !== 'css')
	    		return console.log('Modification d\'un fichier non CSS ('+filename+')');

	    	console.log('CSS changed', f);
	        ftp.put(f, project.directory+filename, function(err) {
				if (err) {
					return logger.error(err);
				}

				logger.notify(filename+' compilé et mis en ligne', 'success');
				logger.success('Fichier uploadé avec succès');

				reloadingBrowsers = true;
				setTimeout(function() {
					if(!reloadingBrowsers)
						return;

					browserSync.reload();
					reloadingBrowsers = false;
				});
		    });
	    });

	    watchers.push(monitor);
  	});
}

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