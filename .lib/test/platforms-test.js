/*global describe, it*/
/*eslint no-sync:0*/
'use strict';

var helpers      = require('./helpers.js');
var fs           = require('fs');
var path         = require('path');
var should       = require('should');
var spawn        = require('child_process').spawn;
var exec         = require('child_process').exec;
var Lazy         = require('lazy');
var assert       = require('assert');

var Converter    = require("csvtojson").Converter;

var platformsFolder = path.join(__dirname, '/../..');
var cfgFilename     = 'manifest.json';

var platforms  = process.env.EZPAARSE_PLATFORM_TO_TEST ? [ process.env.EZPAARSE_PLATFORM_TO_TEST ] : fs.readdirSync(platformsFolder);

function testFiles(files, parserFile, done) {

  var test = exec(parserFile);
  test.on('exit', function (code) {
    assert.ok(code !== 126, 'the parser is not executable');
    assert.ok(code === 0, 'the parser exited with code ' + code);

    // to be able to concatenate test data files 
    function csvConverterFromFiles(csvFiles, cb) {
      var results = [];
      csvFiles.forEach(function (file, idx) {
        var csvConverter = new Converter({ delimiter: ';', checkType: false, ignoreEmpty: true });
        csvConverter.fromFile(file, function (err, records) {
          if (err) throw new Error(err);
          results = results.concat(records);
          if (idx == (csvFiles.length - 1)) return cb(null, results);
        });
      });
    };

    // load records from every test files
    csvConverterFromFiles(files, function (err, records) {
      assert.ok(err === null);

      records = records.map(function (record) {
        var set = {
          in: {},
          out: {}
        };
        for (var prop in record) {
          if (/^in-/.test(prop))       { set.in[prop.substr(3)]  = record[prop]; }
          else if (/^out-/.test(prop)) { set.out[prop.substr(4)] = record[prop]; }
        }

        if (set.out.hasOwnProperty('_granted')) {
          set.out._granted = set.out._granted === 'true';
        }
        return set;
      });

      var child = spawn(parserFile, ['--json']);
      var lazy  = new Lazy(child.stdout);
      var record;

      lazy.lines
        .map(String)
        .map(function (line) {
          var parsedLine = JSON.parse(line);
          should.ok(helpers.equals(parsedLine, record.out, true),
            `result does not match
            input: ${JSON.stringify(record.in, null, 2)}
            result: ${JSON.stringify(parsedLine, null, 2)}
            expected: ${JSON.stringify(record.out, null, 2)}`);
          record = records.pop();
          if (record) {
            assert(record.in.url, 'some entries in the test file have no URL');
            child.stdin.write(JSON.stringify(record.in) + '\n');
          } else {
            child.stdin.end();
          }
        });
      lazy.on('end', function () {
        done();
      });

      record = records.pop();
      if (record) {
        assert(record.in.url, 'some entries in the test file have no URL');
        child.stdin.write(JSON.stringify(record.in) + '\n');
      } else {
        done();
      }
    });
  });

  test.stdin.end('[]');
}

function fetchPlatform(platform) {
  if (!platform) {
    return;
  }

  var platformPath = path.join(platformsFolder, platform);

  // filter things which are not a platform name (ex: .git, node_modules, etc)
  if (/^\./.test(platform) || !fs.statSync(platformPath).isDirectory() || platform == 'node_modules') {
    fetchPlatform(platforms.pop());
    return;
  }

  var configFile = path.join(platformPath, cfgFilename);

  describe(platform, function () {

    it('is usable', function (done) {

      should.ok(fs.existsSync(configFile), 'manifest.json does not exist');
      var config = JSON.parse(fs.readFileSync(configFile, 'UTF-8'));

      should.exist(config.name, 'field \'name\' in manifest.json does not exist');
      should.ok(config.name.length > 0, 'field \'name\' in manifest.json is empty');

      var parserFile = path.join(platformPath, 'parser.js');

      fs.exists(parserFile, function (exists) {
        if (!exists) { return done(); }

        var testFolder = path.join(platformPath, 'test');

        should.ok(fs.existsSync(testFolder) && fs.statSync(testFolder).isDirectory(),
                  'no test folder');

        var files    = fs.readdirSync(testFolder);
        var csvFiles = [];

        for (var i in files) {

          var csvPath = path.join(testFolder, files[i]);

          if (/\.csv$/.test(files[i])) {
            csvFiles.push(csvPath);
          }
        }
        should.ok(csvFiles.length > 0, 'no test file');
        testFiles(csvFiles, parserFile, done);
      });

    });
  });
  fetchPlatform(platforms.pop());
}

describe('The platform', function () {
  this.timeout(10000);
  fetchPlatform(platforms.pop());
});
