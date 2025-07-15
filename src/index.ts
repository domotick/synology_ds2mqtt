import minimist from 'minimist';
import * as mqtt from 'mqtt';
import fetch from 'node-fetch';


console.log('');
console.log('============================');
console.log('= Start Synology DS 2 MQTT =');
console.log('============================');
console.log('');


const rawArgv = process.argv.slice(2);
const args = minimist(rawArgv, {
	string: [
		'mqtt-uri',
		'mqtt-prefix',
		'mqtt-retain',
		'mqtt-qos',
		'ds-url',
		'ds-login',
		'ds-password',
		'scan-interval',
		'ha-discovery',
		'ha-prefix',
		'log'
	],
	boolean: [
		'help',
	],
	alias: {
		'mqtt-uri': 'm',
		'ds-url': 'o',
		'ds-login': 'u',
		'ds-password': 'p',
		'log': 'l',
		'help': 'h',
	},
	default: {
		log: 'MESSAGE',
		'mqtt-prefix': 'synology_ds',
		'mqtt-retain': '1',
		'mqtt-qos': '0',
		'ha-discovery': '1',
		'ha-prefix': 'homeassistant',
		'scan-interval': '30',
		'login-interval': '300',
	}
});

let argError = null;
if (!args.p)  argError = 'ds-password as required';
if (!args.l)  argError = 'ds-login as required';
if (!args.o)  argError = 'ds-uri as required';
if (!args.m)  argError = 'mqtt-uri as required';
if (!args['mqtt-prefix'])  argError = 'mqtt-prefix as required';

if (args.h || argError) {

	if (argError) {
		console.error('ERROR:', argError);
	}

	console.log(`
Run command:
    
    ${process.argv[0]} ${process.argv[1]} [PARAMS]
   
Parameters:
    
    mqtt-uri, m           Set MQTT URI for connection (example: mqtt://login:password@127.0.0.1:1883 or mqtt://127.0.0.1:1883)
    mqtt-prefix           Set prefix for mqtt(default: ds)
    mqtt-retain           Set retain value for MQTT, values must be 0 or 1 (default: 1),
    mqtt-qos              Set QOS value for MQTT, values must be 0, 1 or 2 (default: 0),
    ds-url, o             Set Base URL for Open Media Vault (example: http://192.168.1.1)
    ds-login, o           Set login for Open Media Vault
    ds-password, o        Set password for Open Media Vault
    scan-interval         Set scan refresh interval in second (default: 30) 
    login-interval        Set login refresh interval in second (default: 300)
    ha-discovery          Enable Home Assistant discovery, values must be 0 or 1 (default: 1),
    ha-prefix             Home Assistant discovery prefix (default: homeassistant),
    log, l                Log level (ERROR, MESSAGE, DEBUG) (default MESSAGE)
    help, h               Display help
    
    `);
	process.exit(0);
}

switch(args.l.toLowerCase()) {
	case 'error': console.log = () => {};
	default: console.debug = () => {};
	case 'debug': break;
}

const mqttUri = args.m;
const mqttPrefix = args['mqtt-prefix'];
const mqttRetain = args['mqtt-retain'] === '1' || args['mqtt-retain']?.toLowerCase() === 'true';
let mqttQos = parseInt(args['mqtt-qos'], 10);
switch (mqttQos) {
	case 1: break;
	case 2: break;
	default: mqttQos = 0;
}
const dsUrl = args.o;
const dsLogin = args.u;
const dsPassword = args.p;
let scanIterval = parseInt(args['scan-interval'], 10); isNaN(scanIterval) || scanIterval < 1 ? 30 : scanIterval;
let loginIterval = parseInt(args['login-interval'], 10); isNaN(loginIterval) || loginIterval < 1 ? 300 : loginIterval;
const haDiscovery = args['ha-discovery'] === '1' || args['ha-discovery']?.toLowerCase() === 'true';
const haPrefix = (args['ha-prefix'] || 'homeassistant');

console.log('Config:', `
    mqtt-uri:             ${mqttUri}
    mqtt-prefix:          ${mqttPrefix}
    mqtt-retain:          ${mqttRetain ? 'enabled' : 'disabled'}
    mqtt-qos:             ${mqttQos}
    ds-url:               ${dsUrl}
    ds-login:             ${dsLogin}
    ds-password:          ${dsPassword.replace(/./g, '*')}
    scan-interval:        ${scanIterval}
    login-interval:       ${loginIterval}
    ha-discovery:         ${haDiscovery ? 'enabled' : 'disabled'}
    ha-prefix:            ${haPrefix}
    log:                  ${args.l.toUpperCase()}
`);

const TASK_STATUS_INT = {
	1: 'waiting',
	2: 'downloading',
	3: 'paused',
	4: 'finishing',
	5: 'finished',
	6: 'hash_checking',
	7: 'pre_seeding',
	8: 'seeding',
	9: 'filehosting_waiting',
	10: 'extracting',
	11: 'preprocessing',
	12: 'preprocesspass',
	13: 'downloaded',
	14: 'postprocessing',
	15: 'captcha_needed',
};


const main = async () => {
	try {
		let upTime = new Date();
		let dateLogin = null;
		let sid: string = null;

		const requestDS2 = async (...a: any): Promise<any> => { return 0;};
		const requestDS = async ({
			query = null,
			body = null,
			connected = true,
			method = 'get',
			path = 'entry',
		}: {
			query?: any,
			body?: any,
			connected?: boolean,
			method?: 'get'|'post',
			path?: string,
		}): Promise<any> => {

			if (sid && connected) {
				query = query || {};
				query['_sid'] = sid;
			}

			const url = `${dsUrl}/webapi/${path}.cgi?${Object.entries(query).map(([name, value] : [ string, any ]) => encodeURIComponent(name) + '=' + encodeURIComponent(value)).join('&')}`;
			const options = {
				method,
				...(body ? { body: JSON.stringify(body) } : {}),
			};

			console.debug(`Call POST ${url}`, options);
			const response = await fetch(url, options);

			const json = await response.json();
			console.debug('Response:', {
				json
			});

			return json;
		};

		const login = async () => {
			try {
				if (dateLogin && ((new Date).getTime() - dateLogin.getTime() > loginIterval)) {
					console.debug('Already loggued');
					return;
				}

				console.debug('DS login request');

				const result = await requestDS({
					path: 'auth',
					query: {
						api: 'SYNO.API.Auth',
						method: 'login',
						version: '6',
						account: dsLogin,
						passwd: dsPassword,
						session: 'DS2MQTT',
						format: 'sid'
					},
					connected: false,
				});

				dateLogin = new Date();
				sid = result.data.sid;

				console.log('DS login success');
				console.debug('Login result:', result);
			} catch(e) {
				console.error('ERROR LOGIN:', e);
				throw new Error('ERROR Login failed');
			}
		};

		const callSystem = async() => {
			return requestDS2({ "service": "System", "method": "getInformation", "params": null, "options": null });
		};
		const subscribed: any = {};
		let jsonSystem:any = null;


		const initialize = async () => {
			try {
				await login();
				//jsonSystem = await callSystem();
				console.log('Initialize success');
			} catch(e) {
				console.error('ERROR INITIALIZE:', e);
				console.log('Wait 5 seconds and retry initialize');
				await new Promise(r => setTimeout(r, 5000));
				initialize();
			}
		};
		/*
		await initialize();
		*/

		const subscribe = (topic: string, callback: Function) => {
			client.subscribe(topic, error => { if (error) console.error(error) });
			subscribed[topic] = callback;
		};


		const device = {
			"identifiers": [mqttPrefix],
			"name": `Synology Download Station - ${mqttPrefix.toUpperCase()}`,
			"model": "Synology DS",
			"manufacturer": "Synology",
			'configuration_url': dsUrl,
		};


		const client = mqtt.connect(mqttUri);

		client.on('connect', () => {
			console.log('Connected to MQTT: ', mqttUri);
			//subscribe(`${mqttPrefix}/system/reboot`, reboot);
			//subscribe(`${mqttPrefix}/system/shutdown`, shutdown);
		});

		client.on('error', function (error) {
			console.error('Error to MQTT:', error);
		});


		client.on('message', (topic: string, value: Buffer) => {
			const cb = subscribed[topic];
			if (cb) {
				cb(value.toString());
			}
		});

		/*
		const reboot = async (value: string) => {
			try {
				console.log('MESSAGE: On reboot:', value);
				if (value === 'PRESS') {
					await requestDS({ "service": "System", "method": "reboot", "params": { "delay": 0 }, "options": null });
					publish('system/reboot', 'OK');
				}
			} catch(e) {
				console.error(publish('system/reboot', 'FAILED'));
			}
		};
		const shutdown = async (value: string) => {
			try {
				console.log('MESSAGE: On shutdown:', value);
				if (value === 'PRESS') {
					await requestDS({ "service": "System", "method": "shutdown", "params": { "delay": 0 }, "options": null });
					publish('system/shutdown', 'OK');
				}
			} catch(e) {
				console.error(publish('system/shutdown', 'FAILED'));
			}
		};
		*/

		const publish = (path: string = '', data: any, sub: boolean = false) => {
			if (!sub) {
				path = mqttPrefix + (path ? '/' + path : '');
			}
			if (client.connected) {
				if (typeof data === 'string' || typeof data === 'number'|| data === null) {
					console.debug('Publish:', path, data);
					client.publish(path, data !== null ? data.toString() : '', { retain: mqttRetain, qos: mqttQos as any });
				} else {
					for (const [key, value] of Object.entries(data)) {
						publish( (path ? path + '/' : '') + key, value, true);
					}
				}
			} else {
				console.error('Error: Client MQTT not connected');
			}
		};

		const configHA = (
			type: string,
			id: string,
			name: string,
			path: string,
			extraConf: any = {},
			expireAfter = true,
		) => {
			if (haDiscovery) {
				publish(`${haPrefix}/${type}/${mqttPrefix}/${id.replace(/\W/gi, '_')}/config`, JSON.stringify({
					uniq_id: mqttPrefix + '.' + id,
					object_id: mqttPrefix + '.' + id,
					name: name,
					stat_t: `${mqttPrefix}/${path}/state`,
					json_attr_t: `${mqttPrefix}/${path}/attributes`,
					...(expireAfter ? { expire_after: (scanIterval * 5).toString() } : {}),
					...extraConf
				}), true);
			}
		};


		const buttonHA = (
			type: string,
			id: string,
			name: string,
			path: string,
			extraConf: any = {}
		) => {
			if (haDiscovery) {
				publish(`${haPrefix}/${type}/${mqttPrefix}/${id.replace(/\W/gi, '_')}/config`, JSON.stringify({
					uniq_id: mqttPrefix + '.' + id,
					object_id: mqttPrefix + '.' + id,
					name: name,
					command_topic: `${mqttPrefix}/${path}`,
					...extraConf
				}), true);
			}
		};


		const updateStats = async () => {
			try {
				console.debug('Update list');
				const json = await requestDS({
					query: {
						api: 'SYNO.DownloadStation2.Task.Statistic',
						method: 'get',
						version: 1,
					},
				});

				publish('', {
					'down_speed': {
						state: json.data.download_rate,
						attributes: JSON.stringify({
							suggested_display_precision: 2,
							suggested_unit_of_measurement: 'kB/s',
						})
					},
					'up_speed': {
						state: json.data.upload_rate,
						attributes: JSON.stringify({
							suggested_display_precision: 2,
							suggested_unit_of_measurement: 'kB/s',
						})
					},
				});

				configHA(
					'sensor',
					`down_speed`,
					'Download speed',
					`down_speed`,
					{
						device,
						icon: 'mdi:download-network',
						device_class: 'data_rate',
						state_class: 'measurement',
						unit_of_measurement: 'B/s',
						suggested_display_precision: 2,
						suggested_unit_of_measurement: 'kB/s',
					}
				);

				configHA(
					'sensor',
					`up_speed`,
					'Upload speed',
					`up_speed`,
					{
						device,
						icon: 'mdi:upload-network',
						device_class: 'data_rate',
						state_class: 'measurement',
						unit_of_measurement: 'B/s',
						suggested_display_precision: 2,
						suggested_unit_of_measurement: 'kB/s',
					}
				);

			} catch(e) {
				console.error('ERROR:', e);
				dateLogin = null;
			}
		}

		const updateList = async () => {
			try {
				console.debug('Update list');
				const json = await requestDS({
					query: {
						api: 'SYNO.DownloadStation2.Task',
						method: 'list',
						version: 2,
						additional: JSON.stringify(['transfer']),
					},
				});


				const total = {};
				const completed = {};
				const active = {};
				const paused = {};

				for (const d of json.data.task) {

					const size = d.size;
					const down_speed = d.additional.transfer.speed_download;
					const up_speed = d.additional.transfer.speed_upload;
					const down = d.additional.transfer.size_downloaded;
					const up = d.additional.transfer.size_uploaded;
					const percent_done = (down / size * 100).toFixed(2);

					const info = {
						id: d.id,
						name: d.title,
						status: TASK_STATUS_INT[d.status] || 'error',
						status_id: d.status,
						size: d.size,
						type: d.type,
						username: d.username,
						percent_done,
						down_speed,
						up_speed,
						down,
						up,
					};


					total[d.id] = info;
					if (down === size) completed[d.id] = info;
					if ([ 1, 2, 4, 6, 7, 8, 9, 10, 11, 12, 14, 15 ].indexOf(d.status) !== -1) active[d.id] = info;
					if ([ 3 ].indexOf(d.status) !== -1) paused[d.id] = info;


					publish('task', {
						total: {
							state: Object.values(total).length,
							attributes: JSON.stringify({
								list: JSON.stringify(total)
							})
						},
						completed: {
							state: Object.values(completed).length,
							attributes: JSON.stringify({
								list: JSON.stringify(completed)
							})
						},
						active: {
							state: Object.values(active).length,
							attributes: JSON.stringify({
								list: JSON.stringify(active)
							})
						},
						paused: {
							state: Object.values(paused).length,
							attributes: JSON.stringify({
								list: JSON.stringify(paused)
							})
						},
					});

				}
				configHA(
					'sensor',
					`task.total`,
					'Task total',
					`task/total`,
					{
						device: device,
						icon: 'mdi:file-document-multiple'
					}
				);
				configHA(
					'sensor',
					`task.completed`,
					'Task completed',
					`task/completed`,
					{
						device: device,
						icon: 'mdi:file-document-multiple'
					}
				);
				configHA(
					'sensor',
					`task.active`,
					'Task active',
					`task/active`,
					{
						device: device,
						icon: 'mdi:file-document-multiple'
					}
				);
				configHA(
					'sensor',
					`task.paused`,
					'Task paused',
					`task/paused`,
					{
						device: device,
						icon: 'mdi:file-document-multiple'
					}
				);

			} catch(e) {
				console.error('ERROR:', e);
				dateLogin = null;
			}
		};

		const updateSystem = async () => {
			try {
				console.debug('Update System');

				const [
					infos,
					cpuTemp,
				] = await Promise.all([
					callSystem(),
					requestDS2({ "service": "CpuTemp", "method": "get", "params": null,"options": null }),
				]);

				jsonSystem = infos;

				const newUpTime =  new Date();
				newUpTime.setTime(newUpTime.getTime() - infos.response.uptime * 1000);
				if (Math.abs(upTime.getTime() - newUpTime.getTime()) > 5000) {
					upTime = newUpTime;
				}

				publish('system', {
					hostname: {
						state: infos.response.hostname,
						attributes: JSON.stringify({})
					},
					version: {
						state: infos.response.version,
						attributes: JSON.stringify({})
					},
					cpu_model_name: {
						state: infos.response.cpuModelName,
						attributes: JSON.stringify({})
					},
					kernel: {
						state: infos.response.kernel,
						attributes: JSON.stringify({})
					},
					cpu_usage: {
						state: infos.response.loadAverage['1min'].toString(),
						attributes: JSON.stringify({
							loadaverage_1: infos.response.loadAverage['1min'],
							loadaverage_5: infos.response.loadAverage['5min'],
							loadaverage_15: infos.response.loadAverage['15min'],
						})
					},
					memory: {
						state: (Math.round(infos.response.memUsed / infos.response.memTotal * 10000) / 100).toString(),
						attributes: JSON.stringify({
							total: infos.response.memTotal,
							used: infos.response.memUsed,
							free: infos.response.memFree,
						})
					},
					uptime: {
						state: upTime.toISOString().split('.')[0] + '+00:00',
						attributes: JSON.stringify({})
					},
					update_available: {
						state: infos.response.availablePkgUpdates ? 'ON' : 'OFF',
						attributes: JSON.stringify({})
					},
					config_dirty: {
						state: infos.response.configDirty ? 'ON' : 'OFF',
						attributes: JSON.stringify({})
					},
					reboot_required: {
						state: infos.response.rebootRequired ? 'ON' : 'OFF',
						attributes: JSON.stringify({})
					},
					cpu_temperature: {
						state: cpuTemp.response.cputemp.toString(),
						attributes: JSON.stringify({})
					},
					last_refresh: {
						state: (new Date()).toISOString().split('.')[0] + '+00:00',
						attributes: JSON.stringify({})
					},
				});

				// configHA(
				// 	'sensor',
				// 	`system.hostname`,
				// 	'Hostname',
				// 	`system/hostname`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'mdi:web',
				// 	}
				// );
				// configHA(
				// 	'sensor',
				// 	`system.kernel`,
				// 	'Kernel:',
				// 	`system/kernel`,
				// 	{
				// 		device: deviceSystem,
				// 	}
				// );
				// configHA(
				// 	'sensor',
				// 	`system.version`,
				// 	'Version',
				// 	`system/version`,
				// 	{
				// 		device: deviceSystem,
				// 	}
				// );
				// configHA(
				// 	'sensor',
				// 	`system.cpu_model_name`,
				// 	'CPU Model name',
				// 	`system/cpu_model_name`,
				// 	{
				// 		device: deviceSystem,
				// 	}
				// );
				// configHA(
				// 	'sensor',
				// 	`system.cpu_usage`,
				// 	'CPU Usage',
				// 	`system/cpu_usage`,
				// 	{
				// 		device: deviceSystem,
				// 		unit_of_measurement: '%',
				// 		icon: 'mdi:speedometer',
				// 		state_class: 'measurement'
				// 	}
				// );
				// configHA(
				// 	'sensor',
				// 	`system.memory`,
				// 	'Memory',
				// 	`system/memory`,
				// 	{
				// 		device: deviceSystem,
				// 		unit_of_measurement: '%',
				// 		icon: 'mdi:memory',
				// 		state_class: 'measurement'
				// 	}
				// );
				// configHA(
				// 	'sensor',
				// 	`system.uptime`,
				// 	'Uptime',
				// 	`system/uptime`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'mdi:clock-outline',
				// 		device_class: 'timestamp',
				// 	}
				// );
				// configHA(
				// 	'binary_sensor',
				// 	`system.update_available`,
				// 	'Update available',
				// 	`system/update_available`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'mdi:package',
				// 		device_class: 'update'
				// 	}
				// );
				// configHA(
				// 	'binary_sensor',
				// 	`system.config_dirty`,
				// 	'Config dirty',
				// 	`system/config_dirty`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'mdi:liquid-spot',
				// 		device_class: 'problem',
				// 	}
				// );
				//
				// configHA(
				// 	'binary_sensor',
				// 	`system.reboot_required`,
				// 	'Reboot required',
				// 	`system/reboot_required`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'mdi:restart-alert',
				// 	}
				// );
				// configHA(
				// 	'sensor',
				// 	`system.cpu_temperature`,
				// 	'CPU Temperature',
				// 	`system/cpu_temperature`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'hass:thermometer',
				// 		unit_of_measurement: '°C',
				// 		state_class: 'measurement'
				// 	}
				// );
				//
				// configHA(
				// 	'sensor',
				// 	`system.last_refresh`,
				// 	'Last refresh',
				// 	`system/last_refresh`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'mdi:clock-outline',
				// 		device_class: 'timestamp',
				// 	},
				// 	false
				// );
				//
				// buttonHA(
				// 	'button',
				// 	`system.reboot`,
				// 	'Reboot',
				// 	`system/reboot`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'mdi:restart',
				// 		payload_available: 'OK',
				// 		payload_not_available: 'FAILED',
				// 	}
				// );
				//
				// buttonHA(
				// 	'button',
				// 	`system.shutdown`,
				// 	'Shutdown',
				// 	`system/shutdown`,
				// 	{
				// 		device: deviceSystem,
				// 		icon: 'mdi:power',
				// 		payload_available: 'OK',
				// 		payload_not_available: 'FAILED',
				// 	}
				// );

			} catch(e) {
				console.error('ERROR:', e);
				dateLogin = null;
			}
		};


		const updateDisks = async () => {

			try {

				console.debug('Update Disks');

				const [
					infos,
					smarts,
				] = await Promise.all([
					requestDS2({ "service": "DiskMgmt", "method": "enumerateDevices", "params": { "limit": -1, "start": 0 }, "options": null }).catch(e => {
						console.error('Error on call disks infos', e);
						return null;
					}),
					requestDS2({ "service": "Smart", "method": "getList", "params": { "limit": -1, "start": 0 }, "options": null }).catch(e => {
						console.error('Error on call disks smarts', e);
						return null;
					}),
				]);


				const disks = {};
				for (const info of infos?.response || []) {
					disks[info.devicename] = {
						info
					};
				}
				for (const smart of smarts?.response?.data || []) {
					disks[smart.devicename] = disks[smart.devicename] || {
					};
					disks[smart.devicename].smart = smart;
				}

				for (const [ name, disk ] of Object.entries(disks) as [ string, any ]) {
					const device = {
						"identifiers": [mqttPrefix + '.disk.' + name],
						"name": `${mqttPrefix.toUpperCase()} - Disk - ${name}`,
						"model": "Synology DS",
						"manufacturer": "Synology",
						'configuration_url': dsUrl,
					};

					const attributes = {
						size: disk?.info?.size || 'unknown',
						canonicaldevicefile: disk?.info?.canonicaldevicefile || 'unknown',
						devicefile: disk?.info?.devicefile || 'unknown',
						devicename: disk?.info?.devicename || 'unknown',
						description: disk?.info?.description || 'unknown',
						serialnumber: disk?.info?.serialnumber || 'unknown',
						vendor: disk?.info?.vendor || 'unknown',
						model: disk?.info?.model || 'unknown',
						israid: !!disk?.info?.israid,
						isroot: !!disk?.info?.isroot,
						isreadonly: !!disk?.info?.isreadonly,
						uuid: !!disk?.smart?.uuid || 'unknown',
					};

					publish(`disks/${name}`, {
						smart: {
							state: disk?.smart?.overallstatus || 'unknown',
							attributes: JSON.stringify(attributes)
						},
						temperature: {
							state: (disk?.smart?.temperature || 0).toString(),
							attributes: JSON.stringify(attributes)
						},
					});


					configHA(
						'sensor',
						`disk.${name}.smart`,
						'SMART',
						`disks/${name}/smart`,
						{
							device,
							icon: 'mdi:harddisk',
						}
					);

					configHA(
						'sensor',
						`disk.${name}.temperature`,
						'Temperature',
						`disks/${name}/temperature`,
						{
							device,
							icon: 'hass:thermometer',
							unit_of_measurement: '°C',
							state_class: 'measurement'
						}
					);
				}

			} catch(e) {
				console.error(e);
				dateLogin = null;
			}
		};

		const updateFS = async () => {

			try {

				console.debug('Update Files systems');

				const json = await requestDS2({ "service": "FileSystemMgmt", "method": "enumerateFilesystems", "params": { "limit": -1, "start": 0 }, "options": null });


				for (const fs of json.response) {


					const name = fs.devicename;
					const label = fs.label || fs.devicename;

					const device = {
						"identifiers": [mqttPrefix + '.filesystem.' + name],
						"name": `${mqttPrefix.toUpperCase()} - File System - ${label}`,
						"model": "Synology DS",
						"manufacturer": "Synology",
						'configuration_url': dsUrl,
					};

					const attributes = {
						devicename: name,
						devicefile: fs.devicefile || 'unknown',
						devicefiles: JSON.stringify(fs.devicefiles || []),
						predictabledevicefile: fs.predictabledevicefile || 'unknown',
						canonicaldevicefile: fs.predictabledevicefile.canonicaldevicefile || 'unknown',
						parentdevicefile: fs.parentdevicefile || 'unknown',
						devlinks: JSON.stringify(fs.devlinks || []),
						uuid: fs.uuid || 'unknown',
						label,
						type: fs.type,
						blocks: fs.blocks,
						description: fs.description || '',
						comment: fs.comment || '',
						quota: !fs.propquota,
						resize: !fs.propresize,
						fstab: !fs.propfstab,
						compress: !fs.propcompress,
						auto_defrag: !fs.propautodefrag,
						readonly: !fs.propreadonly,
						has_multiple_devices: !fs.hasmultipledevices,
					};

					publish(`filesystem/${name}`, {
						mounted: {
							state: fs.mounted ? 'ON' : 'OFF',
							attributes: JSON.stringify(attributes)
						},
						occupation: {
							state: (fs.percentage || 0).toString(),
							attributes: JSON.stringify(attributes)
						},
						size: {
							state: (fs.size || 0).toString(),
							attributes: JSON.stringify(attributes)
						},
						free: {
							state: (fs.available || 0).toString(),
							attributes: JSON.stringify(attributes)
						},
						used: {
							state: Math.max(0, ((fs.size || 0) - (fs.available || 0))).toString(),
							attributes: JSON.stringify(attributes)
						},
					});


					configHA(
						'binary_sensor',
						`filesystem.${name}.mounted`,
						'Mounted',
						`filesystem/${name}/mounted`,
						{
							device,
							icon: 'mdi:harddisk',
							device_class: 'plug'
						}
					);

					configHA(
						'sensor',
						`filesystem.${name}.occupation`,
						'Occupation',
						`filesystem/${name}/occupation`,
						{
							device,
							icon: 'mdi:harddisk',
							unit_of_measurement: '%',
						}
					);

					configHA(
						'sensor',
						`filesystem.${name}.size`,
						'Size',
						`filesystem/${name}/size`,
						{
							device,
							icon: 'mdi:harddisk',
							device_class: 'data_size',
							state_class: 'measurement',
							unit_of_measurement: 'B',
							suggested_display_precision: 2,
							suggested_unit_of_measurement: 'GB',
						}
					);

					configHA(
						'sensor',
						`filesystem.${name}.used`,
						'Used',
						`filesystem/${name}/used`,
						{
							device,
							icon: 'mdi:harddisk',
							device_class: 'data_size',
							state_class: 'measurement',
							unit_of_measurement: 'B',
							suggested_display_precision: 2,
							suggested_unit_of_measurement: 'GB',
						}
					);

					configHA(
						'sensor',
						`filesystem.${name}.free`,
						'Free',
						`filesystem/${name}/free`,
						{
							device,
							icon: 'mdi:harddisk',
							device_class: 'data_size',
							state_class: 'measurement',
							unit_of_measurement: 'B',
							suggested_display_precision: 2,
							suggested_unit_of_measurement: 'GB',
						}
					);

				}

			} catch(e) {
				console.error(e);
				dateLogin = null;
			}

		};

		let tick = 0;
		const mainLoop = async () => {

			try {
				console.debug('loop start:', ++tick);

				await login();


				console.log('Update MQTT data');

				await Promise.all([
					updateStats(),
					updateList(),
				]);

			} catch(e) {
				console.error('MAIN LOOP ERROR:', e);
				dateLogin = null;
			}

			await new Promise(r => setTimeout(r, scanIterval * 1000));
			mainLoop();
		};
		mainLoop();


	} catch(e) {
		console.error('MAIN ERROR:', e);
	}
};
main();
