import express from 'express';
import __dirname from './__dirname.js';
import subtitle from './subtitle.js';
import fs from 'fs';

let dir = './subtitles';
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

const app = express()
const port = 3000

app.use(express.static('static'))

app.get('/release/*', async (req, res) => {
  let release = req.originalUrl.substring(9);
  if(!release) throw new Error('no release name');
  await subtitle('subtitles/'+release);
  res.sendFile('subtitles/'+release, {
    root: __dirname
  }, (err)=>{
    if(err){
      throw err;
    } else {
      console.log('file sent');
    }
  });
})

app.get('/log/*', async (req, res) => {
  let logname = req.originalUrl.substring(5);
  if(!logname) throw new Error('no release name');
  if(!fs.existsSync('subtitles/'+logname)) throw new Error('log not found');
  res.sendFile('subtitles/'+logname, {
    root: __dirname
  }, (err)=>{
    if(err){
      throw err;
    } else {
      console.log('file sent');
    }
  });
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})