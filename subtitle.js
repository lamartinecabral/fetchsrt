import cheerio from 'cheerio';
import axios from 'axios';
import leven from 'leven';
import fs from 'fs';
import decompress from 'decompress';

let logBuffer = [];

function getSource(releaseName){
	let x = RegExp([
		'web[^\\.]*',
		'dvd[^\\.]*',
		'bd(r(ip)?)?',
		'blu-?ray',
		'br?rip',
		'hdtv[^\\.]*',
	].map(s=>'\\.'+s+'\\.').join('|'), 'i').exec(releaseName);
	return x && x[0] ? x[0].replace(/\./g,'') : null;
}

function parseReleaseName(str){
	let res = {};
	let i = 1e9;
	let x = (/s\d{2}e\d{2}/i).exec(str);
	if(x){
		res.episode = x[0];
		i = Math.min(x.index-1, i);
	}
	x = (/\.\d{4}\./).exec(str);
	if(x){
		res.year = str.substring(x.index+1, x.index+5);
		i = Math.min(x.index, i);
	}
	x = (/(\.\d{3}p)|(\.\d{4}p)/i).exec(str);
	if(x){
		res.resolution = x[0].substring(1);
		i = Math.min(x.index, i);
	}
	let source = getSource(str);
	if(source){
		res.source = source;
		x = RegExp(source).exec(str);
		i = Math.min(x.index-1, i);
	}
	res.name = str.substring(0, i);
	return res;
}

async function getImdbId(search){
	let url = 'https://www.google.com/search?q='+encodeURIComponent(search);
	let response = await axios.get(url);
	let $ = cheerio.load(response.data);
	let result = $('a[href^="/url?q=https://www.imdb.com/title"]').prop('href');
	return (/tt\d+/).exec(result)[0];
}

function getDownloadLink($){
	let result = $('a#bt-dwl-bt');
	if(!result.length) return null;
	return result.get(0).attribs.href;
}

function getResultList($){
	let release = $('td[id^="main"]').map((i,e)=>$(e).text()).toArray()
		.map(s=>s.replace(/watch online.*/i,'').replace(/.*\n/g,''));
	let downloads = $('a[href^="/en/subtitleserve"]').map((i,e)=>$(e).text())
		.toArray().map(s=>+s.replace(/x.*/,''));
	let ziplink = $('a[href^="/en/subtitleserve"]').map((i,e)=>$(e).prop('href'))
		.toArray();
	let link = $('a[href^="/en/subtitles/"]').map((i,e)=>$(e).prop('href'))
		.toArray();
	return release.map((e,i)=>({
		release: release[i],
		downloads: downloads[i],
		ziplink: ziplink[i],
		link: link[i],
	}));
}

function matchResult(resultList, release){
	let source = (getSource(release) || [''])[0].toLowerCase();
	let filteredList = [];
	if(source) filteredList = resultList.filter(e=>{
		let s = (getSource(e.release) || [''])[0].toLowerCase();
		return source === s;
	});
	if(filteredList.length) return filteredList.sort((a,b)=>{
		return b.downloads-a.downloads;
	})[0];
	let minDistance = 1e9;
	let index = -1;
	resultList.forEach((e,i)=>{
		let distance = leven(e.release, release);
		if(distance < minDistance){
			minDistance = distance;
			index = i;
		}
	})
	return resultList
		.filter(e => minDistance === leven(e.release, release))
		.sort((a,b) => b.downloads-a.downloads)[0];
}

async function save(url, filename){
	let writer = fs.createWriteStream(filename);
	const response = await axios({
		url,
		method: 'GET',
		responseType: 'stream'
	});
	response.data.pipe(writer);
	return new Promise((resolve, reject) => {
		writer.on('finish', resolve)
    writer.on('error', reject)
	});
}

async function extractSubtitle(zip){
	let folder = ((/^.*\//).exec(zip) || [''])[0] || './';
	let filename = (/[^\/]*$/).exec(zip)[0];
	let length = 0;
	let originalSubtitleName;
	await decompress(zip, folder, {
    filter: file => {
			return (/\.srt$/).test(file.path) && !(length++);
		},
		map: file => {
			originalSubtitleName = file.path;
			file.path = filename.replace(/\.[^\.]+$/, '.srt');
			return file;
    }
	})
	return originalSubtitleName;
}

function deleteFile(filename){
	return fs.promises.rm(filename);
}

function log(...txts){
	console.log(...txts);
	logBuffer.push(txts.map(t=>{
		try{
			if(t.toString() === '[object Object]') return JSON.stringify(t);
			return t;
		} catch (e){
			return t;
		}
	}).join(' '));
}

async function saveLog(filename){
	let ret = await fs.promises.writeFile(filename, logBuffer.join('\n'));
	logBuffer = [];
	return ret;
}

async function main(str){
	try{
		if(fs.existsSync(str.replace(/\.[^\.]+$/,'.srt'))){
			return console.log('subtitle already exists');
		}
		let filename = (/\/[^\/]*$/).exec(str)[0].substring(1);
		let info = parseReleaseName(filename);
		log('release parsed', info);
		let imdbId = await getImdbId(`${info.name}+${info.year || info.episode}`);
		log('found imdb id', imdbId);
		let base = 'https://www.opensubtitles.org';
		let path = '/en/search/sublanguageid-pob/imdbid-'
		let sort = '/sort-6/asc-0';
		let url = base + path + imdbId.replace('tt','') + sort;
		log('url', url);
		let response = await axios.get(url);
		log('got response')
		let $ = cheerio.load(response.data);
		let downloadLink = getDownloadLink($);
		if(!downloadLink){
			let resultList = getResultList($);
			let result = matchResult(resultList, str);
			downloadLink = result.ziplink;
		}
		downloadLink = base + downloadLink;
		log('download link', downloadLink);
		let zipfilename = str.replace(/\.[^\.]+$/,'.zip');
		await save(downloadLink, zipfilename);
		log('link downloaded', zipfilename);
		let originalSubtitleName = await extractSubtitle(zipfilename);
		log('subtitle extracted');
		log('original subtitle name:', originalSubtitleName)
		await deleteFile(zipfilename);
		log('zip file deleted');
    await saveLog(str.replace(/\.[^\.]+$/,'.srt.txt'));
	} catch(error){
    log(error.message);
    await saveLog(str.replace(/\.[^\.]+$/,'.srt.txt'));
		throw error;
	}
}

export default main;
