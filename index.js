var express = require('express');
var app = express();
var mysql = require('mysql');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var bodyParser = require("body-parser");

app.set('views', __dirname);
app.engine('html', require('ejs').renderFile);

app.use(express.static('public'));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

var players = {}; //connected users
var names = {};
var db_cache = {};

var game_roles = [ 'Seer', 'Werewolf', 'Werewolf', 'Troublemaker', 'Tanner','Mason','Mason', 'Robber', 'Hunter', 'Insomniac', 'Villager', 
'Minion', 'Drunk', 'Villager' , 'Villager', 'None'];

var role_description = {};

var wake_up_actions = ['Wait', 'Werewolf','Minions','Mason', 'Seer', 'Robber',  'Troublemaker', 'Drunk', 'Insomniac'];
var team_village = ['Seer', 'Troublemaker', 'Mason', 'Robber', 'Hunter', 'Insomniac', 'Villager', 
 'Drunk', 'Villager'];
var team_wolfs = [ 'Werewolf', 'Minion'];

//Declare game state
var game_state = 0;
var waiting = false;

var current_roles = [];
var player_roles = {};
var werewolfs = {};
var player_actions = {};

var total_votes = 0;
var hunter_shot;

app.get('/', function(req, res){
 	res.sendFile(__dirname + '/index.html');
});

app.get('/config', function(req, res){
 	res.sendFile(__dirname + '/lobby.html');
});

app.post('/roles', function(req, res){
 	game_roles = req.body.game_roles;
 	res.sendFile(__dirname + '/index.html');
});

app.post('/game',function(req,res){

	/*if(game_state != 0) {
		res.sendFile(__dirname + '/index.html');
		return;
	};*/

	var name = req.body.name;
	var psw = req.body.psw;
	
	var db = connect_db();

	var sql = "SELECT * FROM user WHERE name = ? AND psw = ?";

	var query = db.query(sql, [name, psw], function(error, result){
      	if(error){
         	throw error;
      	}
	    else {
	        if(result.length > 0){
	        	res.render('game.html', {name : name, psw : psw});
	        	db_cache[name] = result[0];
	        }
	        else {
	        	res.sendFile(__dirname + '/index.html');
	        }
	    }
   	});

	db.end();
});

app.post('/register',function(req,res){
	var name = req.body.name;
	var psw = req.body.psw;
	var cpsw = req.body.cpsw;

	if(psw == cpsw) {

		var db = connect_db();

		var sql = "INSERT INTO user(name, psw, num_games_played, num_games_won) VALUES(?, ?, 0, 0)"; 

		var query = db.query(sql, [name, psw]);
  
 		db.end();
	}

	res.sendFile(__dirname + '/index.html');
  
});

//Server
http.listen(3000, function(){
 	console.log('listening on *:3000');
});

//IO
io.on('connection', function(socket){
	socket.on('disconnect', function() {
		delete players[socket.id];
		delete names[socket.id]
		send_names();
	});
   
	//Chat function
	socket.on('chat message', function(msg){
		io.emit('chat message', msg);
	});
	
	socket.on('set_name', function(msg){
		names[socket.id] = msg;
		send_names();
	});

	//Game functions
	socket.on('give_roles', function(msg){
		io.emit('chat message', msg);
	});

	//Action functions
	socket.on('seer_action', function(target){
		
		if(target == 'none') {
			waiting = false;
			advance_night();
			return;
		}
					
		var t = '';
		
		var num_players = Object.keys(players).length;
		
		if(target != 'middle'){
			t += player_roles[target].role;
		}
		else {
			t += current_roles[num_players + 1] + ',' + current_roles[num_players + 2];
		}
		
		socket.emit('info_text', 'You have seen: ' + t);
			
		waiting = false;
		advance_night();
	});
	
	socket.on('robber_action', function(target){
		
		if(target == 'none') {
			waiting = false;
			advance_night();
			return;
		}
			
		var t = player_roles[target].role;

		socket.emit('info_text', 'You are now: ' + t);
		
		player_roles[target].role = player_roles[socket.id].role;
		player_roles[socket.id].role = t;
		
		waiting = false;
		advance_night();
	});
	
	socket.on('troublemaker_action', function(obj){
		
		if(obj.p1 == 'none') {
			waiting = false;
			advance_night();
			return;
		}
			
		var t = player_roles[obj.p1].role;
		var s = player_roles[obj.p2].role;
		
		player_roles[obj.p1].role = s;
		player_roles[obj.p2].role = t;
		
		socket.emit('info_text', 'You have changed: ' + player_roles[obj.p1].name + '-' + player_roles[obj.p2].name);
		
		waiting = false;
		advance_night();
	});
	
	//Control game functions
	socket.on('start_game', function(msg) {
		
		game_state = 0;
		waiting = false;
		player_roles = {};
		player_actions = {};
		hunter_shot = null;
		total_votes = 0;
		
		io.emit('start_game','');
		
		var num_players = Object.keys(players).length;
		
		var roles = game_roles.slice(0, num_players + 3);
		
		io.emit('game_roles', roles);
		send_names();
		
		var s = shuffle(roles);
		
		current_roles = s;
		
		var j = 0;
		for(i in players) {
			
			var player_obj = {
				role : s[j],
				votes : 0,
				name : names[i],
				dead : false,
				win : false
			};
			
			player_roles[i] = player_obj;			
			players[i].emit('role', s[j]);
			
			if(s[j] == 'Insomniac') {
				insomniac_player = i;
			}
			
			if (typeof player_actions[s[j]] == 'undefined') {
				player_actions[s[j]] = {};
			}
			
			player_actions[s[j]][i] = i;
			
			j++;
		}

		current_names = {};
		
		for(i in player_roles) {
			current_names[i] = player_roles[i].name;
		}
		
		setTimeout(function() {
			advance_night();
		}, 5000);
			
	});
	
	socket.on('vote_player', function(msg) {
		player_roles[msg].votes += 1;
		total_votes++;
		
		if(player_roles[socket.id].role == "Hunter") {
			hunter_shot = msg;
		}

		if(total_votes == Object.keys(players).length) {
			update_statics();
			io.emit('end_game', player_roles);
		}
	});
	
	socket.on('end_game', function(msg) {
		update_statics();
		io.emit('end_game', player_roles);
	});
	
	socket.on('reset_game', function(msg) {
		io.emit('reset_game', '');
		players = [];
		game_state = 0;
	});
	
	//init
	players[socket.id] = socket;
	send_names();

});

//Aux functions

function shuffle(a) {
	var s = a.slice();
    
	var j, x, i;
	
	for(m = 0; m < 10; m++) {
		for (i = s.length; i; i -= 1) {
			j = Math.floor(Math.random() * i);
			x = s[i - 1];
			s[i - 1] = s[j];
			s[j] = x;
		}
	}
	
	return s;
}

function solve_current() {
	
	var werewolfs_text = '';
	var first = false;
	
	switch(game_state) {
		case 1:

			werewolfs = {};
			
			first = true;
		
			for(i in player_actions['Werewolf']) {
				werewolfs[i] = player_roles[i].name;
				
				if(!first) werewolfs_text += ',';
				werewolfs_text += player_roles[i].name;
				
				first = false;
			}
			
			for(i in werewolfs) {
				players[i].emit('info_text', 'Werewolfs are: ' + werewolfs_text);
			}
			
			game_state++;
			
		case 2:
		
			for(i in player_actions['Minion']) {
				if(werewolfs_text != '') players[i].emit('info_text', 'Werewolfs are: ' + werewolfs_text);
				else players[i].emit('info_text', 'There are not werewolfs, you become one');
			}
			
			game_state++;
			
		case 3:
			
			var masons = {};
			var masons_text = '';
			
			first = true;
			
			for(i in player_actions['Mason']) {
				
				masons[i] = player_roles[i].name;
				
				if(!first) masons_text += ',';
				masons_text += player_roles[i].name;
				
				first = false;
				
			}
			
			for(i in masons) {
				players[i].emit('info_text', 'Masons are: ' + masons_text);
			}
			
			break;
		case 4:
		
			for(i in player_actions['Seer']) {
				players[i].emit('pick_action', {names:current_names, type:'seer_action'});
			}
			
			waiting = true;
			break;
		case 5:
		
			for(i in player_actions['Robber']) {
				players[i].emit('pick_action', {names:current_names, type:'robber_action'});
			}
			
			waiting = true;
			break;
		case 6:
			
			for(i in player_actions['Troublemaker']) {
				players[i].emit('pick_action', {names:current_names, type:'troublemaker_action'});
			}
			
			waiting = true;
			break;
		case 7:
		
			var num_players = Object.keys(players).length;
			
			var rand = Math.floor(Math.random() * 3) + num_players;
			
			for(i in player_actions['Drunk']) {
				var sav = player_roles[i].role;
				player_roles[i].role = current_roles[rand];
				current_roles[rand] = sav;
			}
			
			game_state++;
			
		case 8:
		
			for(i in player_actions['Insomniac']) {
				players[insomniac_player].emit('info_text', 'You are: ' + player_roles[insomniac_player].role);
			}
			break;
	}
}

function next_state() {
	game_state++;
	
	var num_players = Object.keys(players).length;
	s = current_roles.slice(0, num_players);
	
	while(s.indexOf(wake_up_actions[game_state]) < 0 && game_state < 9) game_state++;
}

function advance_night() {
	
	if(game_state > 8){
		setTimeout(function() {
			io.emit('day_starts', names);
		}, 5000);
	} 
	
	if(waiting || game_state > 8) return;
	
	next_state();
	solve_current();
	if(game_state < 9 && !waiting) advance_night();
	
	if(game_state > 8){
		setTimeout(function() {
			io.emit('day_starts', names);
		}, 5000);
	} 
	
}

function get_winrate_name(name) {
	if(db_cache[name].num_games_played == 0) return '-';
	return Math.round(db_cache[name].num_games_won/db_cache[name].num_games_played*100) + " %";
}

//send names to clients
function send_names() {
	var aux = {};

	for(var i in names) {
		var name = names[i];
		
		var winrate = get_winrate_name(name);

		var obj_aux = {name: name,winrate : winrate};
		aux[i] = obj_aux;
	}

	io.emit('names', aux);
}

function update_statics() {
	//Update results
	var max = 0;
	for(i in player_roles) {
		if(max < player_roles[i].votes) max = player_roles[i].votes;
	}

	//witch team won?
	var werewolf_dead = false;
	var hunter_dead = false;
	var tanner_dead = false;

	for(i in player_roles) {
		if(player_roles[i].votes == max) {
			if(player_roles[i].role == "Werewolf") {
				werewolf_dead = true;
			}
			if(player_roles[i].role == "Tanner") {
				tanner_dead = true;
			}
			if(player_roles[i].role == "Hunter") {
				hunter_dead = true;
			}

			player_roles[i].dead = true;
		}
	}

	//if hunter dead, kill shoted
	if(hunter_shot != null && hunter_dead) {
		if(player_roles[hunter_shot].role == "Werewolf") {
			werewolf_dead = true;
		}

		player_roles[hunter_shot].dead = true;
	}

	var db = connect_db();
	
	for(i in names) {
		
		var name = names[i];

		var sql = "UPDATE user SET num_games_played = num_games_played + 1, num_games_won = num_games_won + ? ";
		sql += "WHERE name = ?;";

		var won = 0;
		
		if(player_roles[i].role != "Tanner") {
			console.log("prova");
			if((!werewolf_dead) && (team_wolfs.indexOf(player_roles[i].role) > -1)) {
				won = 1;
				player_roles[i].win = true;
			}
			else if(werewolf_dead && !(team_wolfs.indexOf(player_roles[i].role) > -1)) {
				won = 1;
				player_roles[i].win = true;
			}
		}

		if(player_roles[i].role == "Tanner" && player_roles[i].dead) {
			won = 1;
			player_roles[i].win = true;
		}

		var query = db.query(sql, [won, name]);
		db_cache[name].num_games_played++;
		if(won) db_cache[name].num_games_won++;

	}

	db.end();

}

//DB
function connect_db(){
	var con = mysql.createConnection({
	   host: 'llampec.net',
	   user: 'martin',
	   password: 'mdcmdc123',
	   database: 'martin_erp'
	});

	return con;
}

//Game Description


role_description['Seer'] = {'team' : 'Town', 'descr' : 'You can look a card from other player or two cards from the middle. You win with town.'};

