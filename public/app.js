$(function() {
	$('#appForm').submit(function(e) {
		e.preventDefault();

		$('#log').html('');

		$.post(
			baseURL+'watch',
			$(this).serialize(),
			function(d) {
				console.log(d);
			}
		);

		return false;
	})

	var socket = io.connect('localhost:3000');

	// Le jeu nous donne notre place dans la page
	socket.on('log', function(msg) {
		console.log(msg.type, msg.message);

		var content = msg.message;
		while(typeof content !== 'string')
			content = content[0];

		var div = $('<div/>', {class:'alert alert-'+msg.type, html:content});
		$('#log').prepend(div);
	});
	socket.on('notify', function(msg) {
		console.log(msg.title, msg.message);

		return show(msg);
	});

	socket.on('recap', function(recap) {
		if(recap.el == 'hot_reload_local' || recap.el == 'hot_reload_global' || recap.el == 'hot_reload_ui')
			recap.val = '<a href="'+recap.val+'" target="_blank">'+recap.val+'</a>';

		$('#'+recap.el).html(recap.val);
	})
});

var Notification = window.Notification || window.mozNotification || window.webkitNotification;

Notification.requestPermission(function (permission) {
	// console.log(permission);
});

function show(msg) {
	var instance = new Notification(
		msg.title, 
		{
			body: msg.message,
			icon: baseURL+msg.icon+'.png'
		}
	);

	setTimeout(function() {
		instance.close();
	}, 2000);

	return false;
}