# Synology Download Station 2 MQTT

Synology_DS2MQTT is a wrapper for send data on Synology Download Station to MQTT broker.

## Usage

Pull repository

```bash
docker pull smeagolworms4/synology_ds2mqtt
```
Run container:

```bash
docker run -ti \
    -e MQTT_URI=mqtt://login:password@192.168.1.100 \
    -e DS_URL=http://192.168.1.101 \
    -e DS_LOGIN=admin \
    -e DS_PASSWORD=password \
    smeagolworms4/synology_ds2mqtt
```

## Environment variables

```
ENV MQTT_URI=           #Required
ENV DS_URL=             #Required
ENV DS_LOGIN=           #Required
ENV DS_PASSWORD=        #Required
ENV SCAN_INTERVAL=30
ENV LOGIN_INTERVAL=300
ENV DEBUG=MESSAGE
ENV MQTT_PREFIX=synology_ds
ENV MQTT_RETAIN=1
ENV MQTT_QOS=0
ENV HA_DISCOVERY=1
ENV HA_PREFIX=homeassistant
```

## For Dev

Start container

```bash
make up
```

Initialize env

```bash
make init
```

Run watch

```bash
make ds2mqtt-watch
```

## Card Example

```yaml
type: markdown
content: >
  {% if states('sensor.synology_ds_task_total') != 'unavailable' %}
  {% set downloads = state_attr('sensor.synology_ds_task_total','list') |
  from_json%}
  <table>
  <tr>
    <th>Name</th>
    <th>Size</th>
    <th>Speed</th>
    <th>Progression</th>
  </tr>
  {% for key in downloads %}
  {% if downloads[key].size != 'NaN' %}
  <tr>
  <td>
    {{ downloads[key].name }}
  </td>
  <td>
    {{ (downloads[key].size / (1024*1024*1024)) | round(1, 'floor') }} Go
  </td>
  <td>
    {% if downloads[key].down_speed == 0 %}
    {% else %}
    {{ (downloads[key].down_speed / (1024*1024)) | round(0, 'floor') }} Mo/s
    {% endif %}
  </td>
  <td>
    {% if downloads[key].status == 'finished' %}
    <mark />
    {% else %}
    {{ downloads[key].percent_done | regex_replace(find='\.\d+', replace='') }}%
    {% endif %}
  </td>
  </tr>
  {% endif %}
  {% endfor %}
  </table>
  {% endif %}
card_mod:
  style:
    .: |
      ha-card ha-markdown {
        padding: 0px;
      }
    ha-markdown $: |
      th {
        font-weight: bold;
        font-size: 1em;
        text-align: left;
        padding: 8px 12px;
      }
      table{
        border-collapse: collapse;
        font-size: 0.9em;
        font-family: Roboto;
        width: 100%;
        outline: 0px solid #393c3d;
        margin-top: 10px;
      }
      td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 0px solid #1c2020;
      }
      td:nth-child(2), td:nth-child(3) {
        white-space: nowrap;
      }
      tr {
        border-bottom: 0px solid #1c2020;
      }
      tr:nth-of-type(even) {
        background-color: rgb(54, 54, 54, 0.3);
      }
      tr:last-of-type {
        border-bottom: transparent;
      }
      mark {
        background: lightgreen;
        color: #222627;
        border-radius: 5px;
        padding: 5px;
        display: block;
      }
      tr:nth-child(n+2) > td:nth-child(2) {
        text-align: left;
      }

```

## Docker hub

https://hub.docker.com/r/smeagolworms4/synology_ds2mqtt

## Github

https://github.com/Smeagolworms4/synology_ds2mqtt


## Home Assistant Addon

https://github.com/GollumDom/addon-repository
