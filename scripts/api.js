/*
 * This script is meant to be run from the rootfolder with the following command:
 * node scripts/api.js 
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');
var nodegit = require('nodegit');

const nomineeFolder = './nominees';
const screeningFolder = './screening';
const apiRepoURL = 'https://github.com/unicef/publicgoods-api.git';
const pathToApiRepo = path.resolve('../publicgoods-api');
const pathToApiFolder = path.join(pathToApiRepo, 'docs');
const pathAddAll = [
  'docs/dpgs/index.json', 
  'docs/dpg/*',
  'docs/nominees/index.json',
  'docs/nominee/*']

var repository;

/* The following DPGs were assessed differently and there is no screening data,
/* so we exclude them from the regular flow 
*/
const earlyGradeReading = [
  'african-storybook',
  'antura-and-the-letters',
  'book-dash',
  'feed-the-monster',
  'gdl-radio',
  'global-digital-library',
  'h5p',
  'storyweaver']


// Addresses GitHub certificate issue in OS X
// See: https://www.nodegit.org/guides/cloning/
const cloneOptions = {};
cloneOptions.fetchOpts = {
  callbacks: {
    certificateCheck: function() { return 0; }
  }
};

/** 
 * Returns a Javascript object (array) of the files that have changed
 * @return {Array} List of changed files
 */
function getChangedFiles(){
  var obj = JSON.parse(fs.readFileSync(path.join(process.env.HOME,'files.json'), 'utf8'));
  return obj;
}

/** 
/* Checks if any of the changed files are of our interest to run this script
 */
function checkRun(){
  const files = getChangedFiles();
  let found = false;
  for(file of files) {
    if (file.match(/nominees\/.*\.json/)) {
      found = true;
      break
    } else if (file.match(/screening\/.*\.json/)) {
      found = true;
      break
    }
  }
  if(found){
    run()
  } else {
    console.log('No nominee files have changed or been added. Not running script.')
  }
}

/* 
/* Wrapper function to fs.writeFile() to make sure that path exists first
/* fs.mkdir() is thus called first to create the path recursively
*/
function writeFile(folder, filename, content){
  fs.mkdir(folder, { recursive: true }, (err) => {
    if(err){
      console.log("An error occured while creating folder:" + folder);
      return console.log(err);
    } else {
      const pathFilename = path.join(folder, filename);
      fs.writeFile(pathFilename, content, 'utf8', function (err) {
        if (err) {
          console.log("An error occured while writing JSON Object from file: " + pathFilename);
          return console.log(err);
        }
      });
    }
  });
}

/*
/* Appends data from screening to the existing object
*/
function addScreening(jsonObject, name){
  if (!earlyGradeReading.includes(name)) {
    const screeningFile = path.join(screeningFolder, `${name}.json`);
    let screeningData = fs.readFileSync(
      screeningFile,
      'utf8',
      function (err) {
        if (err) {
          console.log("An error occured while reading JSON Object from file: " + screeningFile);
          return console.log(err);
        }
    });

    // Parse JSON object from data
    var screeningObject = JSON.parse(screeningData);

    for(const key in screeningObject){
      if(key != 'name'){
        jsonObject[key] = screeningObject[key]
      }
    }
  }
  return jsonObject;
}

/**
/* Clones repository
*/
function cloneRepo() {
  NodeGit.Clone(apiRepoURL, pathToApiRepo, cloneOptions)
  .then(function() {
    openRepo()
  })
}

/**
/* Opens repository
*/
function openRepo() {
  nodegit.Repository.open(pathToApiRepo)
  .then(function (repo) {
    repository = repo;
    return repository.fetch("origin");
  })
  .then(function() {
    return repository.mergeBranches("main", "origin/main");
  })
  .then(function() {
    run();
  })
  .catch(function(err){
    console.log(`Tried opening repo at ${pathToApiRepo} and merging "main" branch, but errored out.`);
    console.log(err)
  });
}

/**
/* Commit changes
*/
function commit() {
  var oid;
  var index;
  repository.refreshIndex()
  .then(function(indexResult){
    index = indexResult;
    return index.addAll(pathAddAll)
  })
  .then(function() {
    return index.write();
  })
  .then(function() {
    return index.writeTree();
  })
  .then(function(oidResult) {
    oid = oidResult;
    return nodegit.Reference.nameToId(repository, "HEAD");
  })
  .then(function(head) {
    return repository.getCommit(head);
  })
  .then(function(parent) {
    var author = nodegit.Signature.now("Victor Grau Serrat",
      "lacabra@users.noreply.github.com");

    return repository.createCommit("HEAD", author, author, "message", oid, [parent]);
  })
  .then(function(commitId) {
    console.log("New Commit: ", commitId);
  })
  .catch(function(err) {
    if(err.errorFunction == 'Index.addAll' && err.errno == -1){
      console.log('Nothing to commit')
    } else {
      console.log(err)
    }
  })
}

/**
/* Ensures repo is cloned in the specified path
*/
function start() {
  fs.access(pathToApiRepo, function(err) {
    if (err) {
      cloneRepo()
    } else {
      openRepo()
    }
  })
}

function run() {
  // scan for all json files in path
  glob(path.join(nomineeFolder,'*.json'), {}, async (err, files) => {

    let c = 0;
    let n = 0;
    let dpgs = [];
    let nominees = [];

    // for each file in the set do as follows
    for (let i=0; i<files.length; i++) {

      // read data from the file
      let jsonData = fs.readFileSync(files[i], 'utf8', function (err) {
        if (err) {
            console.log("An error occured while reading JSON Object from file: "+files[i]);
            return console.log(err);
        }
      });

      // Parse JSON object from data
      var jsonObject = JSON.parse(jsonData);

      let newObj = { id: path.basename(files[i], '.json') };
      for(const key in jsonObject){
        newObj[key] = jsonObject[key]
      }

      if(jsonObject['stage'] == 'DPG') {
        c++;

        // Push a deep copy of the object at this point in time, 
        // as we do not want to include the additional screening data below
        dpgs.push(JSON.parse(JSON.stringify(newObj)));

        newObj = addScreening(newObj, path.basename(files[i], '.json'))

        // Write the JSON object to file
        writeFile(
          path.join(pathToApiFolder, 'dpg', path.basename(files[i], '.json')), 
          'index.json',
          JSON.stringify(newObj, null, 2) + "\n");
      } else {
        n++;
        nominees.push(newObj);

        // Write the JSON object to file
        writeFile(
          path.join(pathToApiFolder, 'nominee', path.basename(files[i], '.json')), 
          'index.json',
          JSON.stringify(newObj, null, 2) + "\n");
      }
    }

    // Write the JSON array of DPGs
    writeFile(
      path.join(pathToApiFolder, 'dpgs'),
      'index.json',
      JSON.stringify(dpgs, null, 2) + "\n");

    // Write the JSON array of nominees
    writeFile(
      path.join(pathToApiFolder, 'nominees'),
      'index.json',
      JSON.stringify(nominees, null, 2) + "\n");

    console.log(`${c} DPGs found, ${n} nominees found.`);
    commit();
  });
}

start();
