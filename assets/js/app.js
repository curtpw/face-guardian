/*

Face Guardian

*/


// Application object.
var app = {};
app.device = null;

// UI methods.
app.ui = {};

app.useMagnetometer = true;
app.useAccelerometer = false;
app.dataPreProcessing = "delta";

// Timer that updates the device list and removes inactive
// devices in case no devices are found by scan.
app.ui.updateTimer = null;

//data processing loop time interval, controls training data acquisition hence sample rate
//in ms so divide by 1000 to get Hz
app.sampleRate = 160;

//detection threshold
app.sensitivity = 2;

//most recent accelerometer sample
app.lastAccReading = {
    x: 0,
    y: 0,
    z: 0
};

//most recent magnetometer data
app.lastMagReading = {
    x: 0,
    y: 0,
    z: 0,
    magnitude: 0
};

//rolling array of recent magnetometer data
app.magHistory = [];

//the number of samples are we storing for the purposes of a running average
app.magHistoryMax = 120;
var magAv = [0.0, 0.0, 0.0];
var magAvDelayed = [0.0, 0.0, 0.0];
var magNormal = [0.0, 0.0, 0.0];
var magDelta = [0.0, 0.0, 0.0];
var magMax = [0.0, 0.0, 0.0];
var magMin = [0.0, 0.0, 0.0];

//magnetometer watcher object
var magWatchID = 0;

//accelerometer watcher object
var acWatchID = 0;


/**
 * Nueral net control flags
 */
app.getTrueFlag = false;
app.getFalseFlag = false;
app.trainFlag = false;
app.activateNeuralNetworkModelFlag = false;
app.neuroSendFlag = false;
app.betweenDetectionsFlag = false;
app.betweenDetectionsFalseIntervalFlag = false; //indicate false output between detections to differentiate detections
app.getDelay = 0;

/**
 * Nueral net data
 */
app.latestScore = 0;
app.scoreHistory = [0.1, 0.1, 0.1];
app.scoreHistoryMax = 10;
app.scoreAv = 0;
app.detectionCount = 0;
app.lastAlertTime = Date.now();

/**
 * TARGET defines (inverted).
 */
app.targetOFF = 1;
app.targetON = 0;
app.totalTargets = 0;
app.setTargetFlag = false;

/**
 * Set of Training data
 */
app.trainingDataTrue = [];
app.trainingDataFalse = [];

/**
 * Attach synaptic neural net components to app object
 */
app.Neuron = synaptic.Neuron;
app.Layer = synaptic.Layer;
app.Network = synaptic.Network;
app.Trainer = synaptic.Trainer;
app.Architect = synaptic.Architect;
app.neuralNet = new app.Architect.LSTM(3, 3, 3, 1);

function initGenericSensorAPI() {
    navigator.permissions.query({
            name: 'accelerometer'
        })
        .then(result => {
            if (result.state === 'denied') {
                console.log('Permission to use accelerometer sensor is denied.');
                return;
            }
            // Use the sensor.

            let accelerometer = null;
            try {
                accelerometer = new Accelerometer({
                    frequency: 60,
                    referenceFrame: 'device'
                });
                accelerometer.addEventListener('error', event => {
                    // Handle runtime errors.
                    if (event.error.name === 'NotAllowedError') {
                        // Branch to code for requesting permission.
                        console.log('Branch to code for requesting accelerometer permission.');
                    } else if (event.error.name === 'NotReadableError accelerometer') {
                        console.log('Cannot connect to the accelerometer sensor.');
                    }
                });
                // accelerometer.addEventListener('reading', () => reloadOnShake(accelerometer));
                accelerometer.addEventListener("reading", () => {
             //       console.log("accelerometer.x/y/z: " + accelerometer.x + " " + accelerometer.y + " " + accelerometer.z);
                    app.lastAccReading.x = accelerometer.x;
                    app.lastAccReading.y = accelerometer.y;
                    app.lastAccReading.z = accelerometer.z;
                });
                accelerometer.start();
            } catch (error) {
                // Handle construction errors.
                if (error.name === 'SecurityError') {
                    // See the note above about feature policy.
                    console.log('Accelerometer sensor construction was blocked by a feature policy or permission.');
                } else if (error.name === 'ReferenceError') {
                    console.log('Accelerometer sensor is not supported by the User Agent.');
                } else {
                    console.log('Accelerometer throw error');
                    throw error;
                }
            }
        });

    navigator.permissions.query({
            name: 'magnetometer'
        })
        .then(result => {
            if (result.state === 'denied') {
                console.log('Permission to use magnetometer sensor is denied.');
                return;
            }
            // Use the sensor.

            let magnetometer = null;
            try {
                magnetometer = new Magnetometer({
                    frequency: 60,
                    referenceFrame: 'device'
                });
                magnetometer.addEventListener('error', event => {
                    // Handle runtime errors.
                    if (event.error.name === 'NotAllowedError') {
                        // Branch to code for requesting permission.
                        console.log('Branch to code for requesting magnetometer permission.');
                    } else if (event.error.name === 'NotReadableError') {
                        console.log('Cannot connect to the magnetometer sensor.');
                    }
                });
                //  magnetometer.addEventListener('reading', () => reloadOnShake(magnetometer));
                magnetometer.addEventListener("reading", () => {
             //       console.log("magnetometer.x/y/z: " + magnetometer.x + " " + magnetometer.y + " " + magnetometer.z);
                    app.lastMagReading.x = magnetometer.x;
                    app.lastMagReading.y = magnetometer.y;
                    app.lastMagReading.z = magnetometer.z;
                });
                magnetometer.start();
            } catch (error) {
                // Handle construction errors.
                if (error.name === 'SecurityError') {
                    // See the note above about feature policy.
                    console.log('magnetometer Sensor construction was blocked by a feature policy or permission.');
                } else if (error.name === 'ReferenceError') {
                    console.log('magnetometer Sensor is not supported by the User Agent.');
                } else {
                    console.log('magnetometer throw error');
                    throw error;
                }
            }
        });

}


/**
 * When low level initialization complete, this function is called.
 */
document.addEventListener('deviceready', function() {
    onDeviceReady();
}, false);

function onDeviceReady() {
    console.log("onDeviceReady()");
}

/**
 * Low App initialization 
 */
app.initialize = function() {


    // Called when HTML page has been loaded.
    $(document).ready(function() {

        //information drawer close utility
        function close() {
            //var d = document.querySelector('.mdl-layout');
            //d.MaterialLayout.toggleDrawer();
            $('.mdl-layout__drawer').toggleClass('is-visible');
        }


        document.querySelector('.close-x').addEventListener('click', close);

        // Adjust canvas size when browser resizes
        $(window).resize(app.respondCanvas);

        // Adjust the canvas size when the document has loaded.
        app.respondCanvas();

        //smoothie chart for streaming data
        initializeChart();

        //ENABLE EVERYTHING 
        //enable neural network UI
        enableButton('getTrueButton');
        enableButton('clearTrueButton');
        enableButton('getFalseButton');
        enableButton('clearFalseButton');
        enableButton('numTrueData');
        enableButton('numFalseData');


        //main loop
        setInterval(function() {

            //pre-process magnetometer data
            processData();

            //LSTM Recursive Neural Network (RNN) training and activation
            detectionModel();

            if ($("#dataPageButton").hasClass("is-active")) {
                detectionModel();
                if ($("#graph-title").hasClass("example-data-title")) {

                } else {
                    $("#graph-title").html("Streaming Data");
                    $("#graph-title").addClass("example-data-title")
                }
            }
        }, app.sampleRate);

        //hide launch overlay
        $(".loader-launch").delay(3000).fadeOut(300);

    });
};


//smoothie chart data vis
//var chart = new SmoothieChart({minValue: 0, maxValue: 20});
var chart = new SmoothieChart({
    millisPerPixel: 30,
    minValue: 0,
    maxValue: 1,
    grid: {
        strokeStyle: 'rgb(155, 155, 155)',
        fillStyle: 'rgb(0, 0, 0)',
        lineWidth: 1,
        millisPerLine: 1000,
        verticalSections: 6,
    },
    labels: {
        disabled: true,
        showIntermediateLabels: false,
        fontSize: 12,
        fillStyle: '#ffffff'
    }
});

var lineRoll = new TimeSeries();
var linePitch = new TimeSeries();
var lineMagX = new TimeSeries();
var lineMagY = new TimeSeries();
var lineMagZ = new TimeSeries();
var lineNN = new TimeSeries();

function initializeChart() {
    console.log("init chart");
    chart.streamTo(document.getElementById("streaming-data-chart"), 200 /*delay*/ ); //delay by one second because data acquisition is slow
    chart.addTimeSeries(lineRoll, {
        strokeStyle: 'rgb(255, 0, 255)',
        lineWidth: 4
    });
    chart.addTimeSeries(linePitch, {
        strokeStyle: 'rgb(255, 191, 0)',
        lineWidth: 4
    });
    chart.addTimeSeries(lineMagX, {
        strokeStyle: 'rgb(244, 41, 65)',
        lineWidth: 4
    });
    chart.addTimeSeries(lineMagY, {
        strokeStyle: 'rgb(0, 176, 24)',
        lineWidth: 4
    });
    chart.addTimeSeries(lineMagZ, {
        strokeStyle: 'rgb(60, 150, 250)',
        lineWidth: 4
    });
    chart.addTimeSeries(lineNN, {
        strokeStyle: 'rgb(57, 255, 20)',
        lineWidth: 5
    });
}




/************************************************************
 *************************************************************
 ************* GATHER DATA FOR NEURAL NETWORK TRAINING *******
 ************* APPLY NEURAL NETWORK ACTIVATION FUNCTION ******
 *************************************************************
 ************************************************************/

function detectionModel() {

    //check sensor type option selection UI
    if ($(".option-accelerometer-select").hasClass("is-checked")) {
        app.useMagnetometer = false;
        app.useAccelerometer = true;
    } else {
        app.useMagnetometer = true;
        app.useAccelerometer = false;
    }

    //check data preprocessing option selection UI
    if ($(".smoothed-data-option").hasClass("is-checked")) {
        app.dataPreProcessing = "smooth";
    } else {
        app.dataPreProcessing = "delta";
    }

    if ($("#dataPageButton").hasClass("is-active")) {


        if (app.trainFlag == false) {
            //  console.log("MagX: " + app.lastMagReading.x + "\tMagY: " + app.lastMagReading.y + "\tMagZ: " + app.lastMagReading.z + "\tMagS: " + app.lastMagReading.magnitude);
            //  console.log("MagAvX: " + magAv[0] + "\tMagAvY: " + magAv[1] + "\tMagAvZ: " + magAv[2]);
            console.log("magNormalX: " + magNormal[0] + "\tmagNormalY: " + magNormal[1] + "\tmagNormalZ: " + magNormal[2]);
            console.log("magDeltaX: " + magDelta[0] + "\tmagDeltaY: " + magDelta[1] + "\tmagDeltaZ: " + magDelta[2]);

            var acc = [app.lastAccReading.x, app.lastAccReading.y, app.lastAccReading.z];
            var pitch = (180 / 3.141592) * (Math.atan2(acc[0], Math.sqrt(acc[1] * acc[1] + acc[2] * acc[2])));
            var roll = (180 / 3.141592) * (Math.atan2(-acc[1], -acc[2]));

            console.log("pitch: " + pitch + "\troll: " + roll);

            //select data type for processing
            var values = new Array();
            //if we are using magnets AND change over time AND we already have a model
            if (app.useMagnetometer && app.dataPreProcessing == "delta" && app.activateNeuralNetworkModelFlag) {
                values[0] = magDelta[0];
                values[1] = magDelta[1];
                values[2] = magDelta[2];

                //any other situation with magnets
            } else if (app.useMagnetometer) {
                values[0] = magNormal[0];
                values[1] = magNormal[1];
                values[2] = magNormal[2];

            } else if (app.useAccelerometer) {
                values[0] = (pitch + 180) / 360;
                values[1] = (roll + 180) / 360;
            }

            var now = Date.now();
        }

        /*************************** UPDATE CHART SENSOR DATA *****************************/

        if (app.activateNeuralNetworkModelFlag == false && app.trainFlag == false) { //oncle we have a nn model we only visualize that

            if (app.useMagnetometer) {
                lineMagX.append(now, (values[0] / 2.5) + 0.55);
                lineMagY.append(now, (values[1] / 2.5) + 0.35);
                lineMagZ.append(now, (values[2] / 2.5) + 0.15);

                app.showInfo('Displaying magnetometer x/y/z data');

            } else if (app.useAccelerometer) {
                linePitch.append(now, (values[0] / 1.8) + 0.4);
                lineRoll.append(now, (values[1] / 1.8) + 0.05);

                app.showInfo('Displaying accelerometer pitch/roll data');
            }
        }

        /************************** AUTOMATED TRAINING THRESHOLDS ***********************************/
        if (app.trainingDataTrue.length > 50 && app.trainingDataFalse.length > 50) {
            enableButton("trainButton");
        }

        //automatically start traiing model if 100 samples from both on and off target
        if (app.trainingDataTrue.length >= 100 && app.trainingDataFalse.length >= 100 && app.activateNeuralNetworkModelFlag != true) {
            app.trainFlag = true;
        }


        /*************************** START ACTIVATE NEURAL NETWORK ***********************************/
        if (app.activateNeuralNetworkModelFlag) {

            app.showInfo('Displaying detection model output');

            if (app.useMagnetometer) {
                app.latestScore = app.neuralNet.activate([
                    values[0],
                    values[1],
                    values[2]
                ]);

            } else if (app.useAccelerometer) {
                app.latestScore = app.neuralNet.activate([
                    values[0],
                    values[1]
                ]);
            }

            console.log("values[0]: " + values[0] + "\tvalues[1]: " + values[1]);

            //from 0-1 to 0-100%
            app.latestScore = app.latestScore * 100;

            //add score to history
            app.scoreHistory.unshift(app.latestScore);

            //if we have enough data in history
            if (app.scoreHistory.length > app.scoreHistoryMax) {

                app.scoreHistory.pop();
                var scoreAvTemp = [];

                for (var i = 0; i < app.scoreHistory.length; i++) {
                    scoreAvTemp.push(app.scoreHistory[i].x);
                }
                app.scoreAv = scoreAvTemp.reduce((previous, current) => current += previous) / scoreAvTemp.length;

                //SCORE SMOOTHING
                app.latestScore = (app.scoreHistory[0] + app.scoreHistory[1] + app.scoreHistory[2]) / 3;
            }

            //round to three sig digits
            app.latestScore = (Math.round(app.latestScore * 1000)) / 1000;

            //DETECT EVENTS
            app.alertDetect();

            //display score in data visualization chart
            lineNN.append(now, (app.latestScore / 100));
            app.showInfo('Detection: ' + app.latestScore.toFixed(2) + "%");
        }
        /*************************** END ACTIVATE NEURAL NETWORK ***********************************/

        /*************************** GET TRUE/ON TARGET SAMPLES ******************************/
        if (app.getTrueFlag && app.trainingDataTrue.length < 100) {

            if (app.useMagnetometer) {
                app.trainingDataTrue.push({
                    input: [values[0], values[1], values[2]],
                    output: [1]
                });

            } else if (app.useAccelerometer) {
                app.trainingDataTrue.push({
                    input: [values[0], values[1]],
                    output: [1]
                });
            }

            app.showInfo(" ...gathering face touch data");
            $("#numTrueData").attr("data-badge", app.trainingDataTrue.length);
        }


        /*************************** GET FALSE/OFF TARGET SAMPLES ******************************/
        else if (app.getFalseFlag && app.trainingDataFalse.length < 100) {
            if (app.useMagnetometer) {
                app.trainingDataFalse.push({
                    input: [values[0], values[1], values[2]],
                    output: [0]
                });

            } else if (app.useAccelerometer) {
                app.trainingDataFalse.push({
                    input: [values[0], values[1]],
                    output: [0]
                });
            }

            console.log("trainingDataFalse input: " + app.trainingDataFalse[app.trainingDataFalse.length - 1].input[0] + " " + app.trainingDataFalse[app.trainingDataFalse.length - 1].input[1] + " " + app.trainingDataFalse[app.trainingDataFalse.length - 1].input[2]);

            app.showInfo(" ...gathering away from face data");
            $("#numFalseData").attr("data-badge", app.trainingDataFalse.length);
        }


        /********************************* TRAIN LSTM RNN MODEL ***********************************/
        if (app.trainFlag) {

            app.showInfo('Training detection model...');
            console.log("**Training...");

            /****** CONVERT ABSOLUTE DATA VALUES TO DELTAS ******/
            if (app.dataPreProcessing == "delta") {

                //find averages from false/off target data
                var trainFalseAv = [];
                var falseAvTempX = [];
                var falseAvTempY = [];
                var falseAvTempZ = [];

                for (var i = 0; i < app.trainingDataFalse.length; i++) {
                    falseAvTempX.push(app.trainingDataFalse[i].input[0]);
                    falseAvTempY.push(app.trainingDataFalse[i].input[1]);
                    falseAvTempZ.push(app.trainingDataFalse[i].input[2]);
                }

                trainFalseAv[0] = falseAvTempX.reduce((previous, current) => current += previous) / falseAvTempX.length;
                trainFalseAv[1] = falseAvTempY.reduce((previous, current) => current += previous) / falseAvTempX.length;
                trainFalseAv[2] = falseAvTempZ.reduce((previous, current) => current += previous) / falseAvTempX.length;

                //calculate deltas for true/on target training data
                var randFalseSample;
                for (var j = 0; j < app.trainingDataTrue.length; j++) {

                    randFalseSample = app.trainingDataFalse[Math.floor(Math.random() * app.trainingDataFalse.length)];

                    app.trainingDataTrue[j].input[0] = Math.abs(app.trainingDataTrue[j].input[0] - (trainFalseAv[0] * 3 + randFalseSample.input[0]) / 4);
                    app.trainingDataTrue[j].input[1] = Math.abs(app.trainingDataTrue[j].input[1] - (trainFalseAv[1] * 3 + randFalseSample.input[1]) / 4);
                    app.trainingDataTrue[j].input[2] = Math.abs(app.trainingDataTrue[j].input[2] - (trainFalseAv[2] * 3 + randFalseSample.input[2]) / 4);
                }

                //calculate deltas for false/off target training data
                for (var k = 0; k < app.trainingDataFalse.length; k++) {
                    randFalseSample = app.trainingDataFalse[Math.floor(Math.random() * app.trainingDataFalse.length)];

                    app.trainingDataFalse[k].input[0] = Math.abs(app.trainingDataFalse[k].input[0] - (trainFalseAv[0] * 3 + randFalseSample.input[0]) / 4);
                    app.trainingDataFalse[k].input[1] = Math.abs(app.trainingDataFalse[k].input[1] - (trainFalseAv[1] * 3 + randFalseSample.input[1]) / 4);
                    app.trainingDataFalse[k].input[2] = Math.abs(app.trainingDataFalse[k].input[2] - (trainFalseAv[2] * 3 + randFalseSample.input[2]) / 4);
                }
            }


            //Recreate neural net and trainer
            if (app.useMagnetometer) {
                app.neuralNet = new app.Architect.LSTM(3, 4, 3, 1);
            } else {
                app.neuralNet = new app.Architect.LSTM(2, 4, 3, 1);
            }

            app.trainer = new app.Trainer(app.neuralNet);

            var trainingData = app.trainingDataTrue.concat(app.trainingDataFalse);
            var iterationCount = 0;

            console.log("NN1 Training data length: " + trainingData.length + "  input length: " + trainingData[2].input.length + "  output length: " + trainingData[2].output.length);
            for (var f = 0; f < trainingData.length; f++) {
                console.log("trainingData " + f + ": input: " + trainingData[f].input[0] + " " + trainingData[f].input[1] + " output:" + trainingData[f].output[0]);
            }

            //synaptic hyperparameters and controls
            var numIterations = 2000;
            var numRate = 0.06;
            var numError = 0.20;
            var numLogInterval = 100;
            var numScheduleInterval = 100;

            //display training spinner overlay
            $(".loader-training").show();

            //timeout allows training splash screen to load
            setTimeout(function() {
                app.trainer.train(trainingData, {
                    rate: numRate,
                    iterations: numIterations,
                    error: numError,
                    shuffle: true,
                    log: numLogInterval,
                    cost: app.Trainer.cost.CROSS_ENTROPY,
                    schedule: {
                        every: numScheduleInterval, // repeat this task every 500 iterations
                        do: function(data) {
                            // custom log
                            console.log("schedule log - error:" + data.error + " iterations:" + data.iterations + " rate:" + data.rate);
                        }
                    }
                });


                app.showInfo('Detection Model Training Completed');
                console.log("**End Training...");

                app.activateNeuralNetworkModelFlag = true;
                app.trainFlag = false;

                //hide training spinner overlay
                $(".loader").hide();

                //hide train button progress bar
                $("#training-progress").hide();

                //clear data history to remove detection artifact
                app.magHistory = [];

                //clear data
                //  app.trainingDataTrue = [];
                //  $("#numTrueData").attr( "data-badge", 0 );

                //  app.trainingDataFalse = [];
                //  $("#numFalseData").attr( "data-badge", 0 );

            }, 300);
        }
    } //is on data page?
}


/************************************************************
 *************************************************************
 **************** ALERT USER IF TOUCH DETECTED ***************
 *************************************************************
 ************************************************************/

app.alertDetect = function() {

    //get sensitivity from UI
    app.sensitivity = $("#sensitivity-slider").val();

    if ((app.latestScore > 95 && app.sensitivity == 0) ||
        (app.latestScore > 85 && app.sensitivity == 1) ||
        (app.latestScore > 75 && app.sensitivity == 2) ||
        (app.latestScore > 60 && app.sensitivity == 3) ||
        (app.latestScore > 40 && app.sensitivity == 4)) {
        /********** CORDOVA VIBRATION PLUGIN ALERT **********/
        console.log("app.betweenDetectionsFlag: " + app.betweenDetectionsFlag + "\t" + "app.betweenDetectionsFalseIntervalFlag: " + app.betweenDetectionsFalseIntervalFlag);
        if (app.betweenDetectionsFlag == false && app.betweenDetectionsFalseIntervalFlag == true) {

            app.betweenDetectionsFlag = true;
            app.detectionCount++;
            //update detection event count display
            $(".countValueLabel").html(app.detectionCount);

            //phone vibration motor activated
            if ($(".vibration-checkbox-label").hasClass("is-checked")) {
                console.log("**vibration alert");
                navigator.vibrate(1500);
            }

            //play audio alert
            var audioAlert = $("#audio-alert")[0];
            if ($(".audio-checkbox-label").hasClass("is-checked")) {
                console.log("**audio alert");

                audioAlert.play();
                setTimeout(function() {
                    audioAlert.pause();
                    audioAlert = $("#audio-alert")[0];
                }, 1500);
            } else {
                //sometime audio plays when it shouldn't - this fixes
                audioAlert.pause();
            }

            //    clearTimeout(alertTimeout);

            //allow next detection event
            if (app.useMagnetometer && app.dataPreProcessing == "delta") {
                app.betweenDetectionsFlag
                setTimeout(function() {
                    app.betweenDetectionsFlag = false;
                }, 5000);

            } else {
                setTimeout(function() {
                    app.betweenDetectionsFlag = false;
                }, 3000);
            }
            /*  app.lastAlertTime = Date.now();
              console.log("app.lastAlertTime: " + app.lastAlertTime); */
            app.betweenDetectionsFalseIntervalFlag = false;
        }

        /*    if( (Date.now() - app.lastAlertTime) > 4000){
                app.betweenDetectionsFlag = false; 
            } */
    } else {
        //make sure detection event isn't counted multiple times
        app.betweenDetectionsFalseIntervalFlag = true;
    }
};




/************************************************************
 *************************************************************
 **************** BUTTON: MIRROR UI TOGGLE *******************
 *************************************************************
 ************************************************************/

app.onMirrorButton = function() {
    console.log("app.onMirrorButton");
    $("body").toggleClass("mirror")
};


/************************************************************
 *************************************************************
 **************** BUTTON: TEST MAGNET STRENGTH ***************
 *************************************************************
 ************************************************************/

app.onMagnetTestButton = function() {
    //set baseline magnetic field measurement
    var magnetBaseline = Object.assign({}, magAv);

    //update test on interval
    var magnetTestInterval = setInterval(() => {
        var magneticFieldChange = [];
        magneticFieldChange[0] = Math.abs(magnetBaseline[0] - (app.magHistory[0].x + app.magHistory[1].x + app.magHistory[2].x + app.magHistory[3].x) / 4);
        magneticFieldChange[1] = Math.abs(magnetBaseline[1] - (app.magHistory[0].y + app.magHistory[1].y + app.magHistory[2].y + app.magHistory[3].y) / 4);
        magneticFieldChange[2] = Math.abs(magnetBaseline[2] - (app.magHistory[0].z + app.magHistory[1].z + app.magHistory[2].z + app.magHistory[3].z) / 4);

        console.log("magnetBaseline: " + magnetBaseline[0] + "\t" + magnetBaseline[1] + "\t" + magnetBaseline[2]);
        console.log("magneticFieldChange: " + magneticFieldChange[0] + "\t" + magneticFieldChange[1] + "\t" + magneticFieldChange[2]);

        var netFieldChange = Math.abs(magneticFieldChange[0]) + Math.abs(magneticFieldChange[1]) + Math.abs(magneticFieldChange[2]);
        $("#magnetTestButton").html("<span class='active-test'>" + netFieldChange.toFixed(2) + "&nbsp;uT</span></div>");

        if (netFieldChange > 10) {
            $("#magnetTestButton").css({
                "background-color": "#00b300"
            }); //green
        } else {
            $("#magnetTestButton").css({
                "background-color": "#b30000"
            }); //red
        }
    }, 200);

    //end test after X seconds
    setTimeout(() => {
        clearInterval(magnetTestInterval);
        $("#magnetTestButton").css({
            "background-color": "#51a8f9"
        });
        $("#magnetTestButton").html("<i class='material-icons'>network_check</i>Test Magnet<div class='mdl-layout-spacer'></div>");
    }, 10000);

};




/**
 * BUTTON UTILITY: limit number of selected targets and warn
 */
app.onClickTarget = function(code) {
    console.log("target input click");
    $('.mdl-js-checkbox').each(function(index, element) {
        if ($(this).find('input').attr("code") == code) {

        } else {
            element.MaterialCheckbox.uncheck();
        }
    });
}



/**
 * BUTTON UTILITY: Initiate model training
 */
app.onTrainButton = function() {
    console.log("app.onTrainButton");
    app.activateNeuralNetworkModelFlag = false;
    app.trainFlag = true;
    //show indeterminate progress bar
    $("#training-progress").show();

};


/**
 * BUTTON UTILITY: Gather neural net training data for true condition - when on target
 */
app.onGetTrueButton = function() {
    console.log("app.onGetTrueButton");

    app.getTrueFlag = !app.getTrueFlag;

    if (app.getTrueFlag) {
        $("#getTrueButton").html("STOP");
    } else {
        $("#getTrueButton").html("Add On Target");
    }
};

/**
 * BUTTON UTILITY: Gather neural net training data for false condition - when off target
 */
app.onGetFalseButton = function() {
    console.log("app.onGetFalseButton");

    app.getFalseFlag = !app.getFalseFlag;

    if (app.getFalseFlag) {
        $("#getFalseButton").html("STOP");
    } else {
        $("#getFalseButton").html("Add Off Target");
    }
};

/**
 * BUTTON UTILITY: Clear True Training set
 */
app.onClearTrueButton = function() {
    console.log("app.onClearTrueButton");
    app.trainingDataTrue = [];
    $("#numTrueData").attr("data-badge", 0);
    //  document.getElementById('numTrueData').innerHTML = "0";

    app.trainingDataTrue = [];

    disableButton("trainButton");
};

/**
 * BUTTON UTILITY: Clear True Training set
 */
app.onClearFalseButton = function() {
    console.log("app.onClearFalseButton");
    app.trainingDataFalse = [];
    $("#numFalseData").attr("data-badge", 0);
    //  document.getElementById('numFalseData').innerHTML = "0";

    app.trainingDataFalse = [];

    disableButton("trainButton");
};

/**
 * SLIDER UTILITY: Sensitivity slider value change
 */
app.onSetSensitivity = function() {
    //$( "#sensitivity-slider" ).change(function() {
    app.sensitivity = $("#sensitivity-slider").val();
    console.log("Sensitivity slider value: " + sensitivity);

    if (sensitivity == 0) $(".sensitivity-label").html("Sensitivity: <span>very low</span>");
    if (sensitivity == 1) $(".sensitivity-label").html("Sensitivity: <span>low</span>");
    if (sensitivity == 2) $(".sensitivity-label").html("Sensitivity: <span>medium</span>");
    if (sensitivity == 3) $(".sensitivity-label").html("Sensitivity: <span>high</span>");
    if (sensitivity == 4) $(".sensitivity-label").html("Sensitivity: <span>very high</span>");
    //});
};


/************************************************************
 *************************************************************
 **************** MISC UTILITY FUNCTIONS *********************
 *************************************************************
 ************************************************************/

/**
 * Adjust the canvas dimensions based on its container's dimensions.
 */
app.respondCanvas = function() {
    var canvas = $('#streaming-data-chart');
    var container = $(canvas).parent();
    canvas.attr('width', ($(container).width() * 1.00)); // Max width
    // Not used: canvas.attr('height', $(container).height() ) // Max height
};


/**
 * Print debug info to console and application UI.
 */
app.showInfo = function(info) {
    document.getElementById('info').innerHTML = info;
    console.log(info);
};


/**
 * Other Utility Functions
 */
function enableButton(buttonID) {
    var btn = document.getElementById(buttonID);
    btn.removeAttribute("disabled");
    componentHandler.upgradeElement(btn);
}

function disableButton(buttonID) {
    var btn = document.getElementById(buttonID);
    btn.setAttribute("disabled", "");
    componentHandler.upgradeElement(btn);
}

function mergeObjects(obj, src) {
    Object.keys(src).forEach(function(key) {
        obj[key] = src[key];
    });
    return obj;
}


function processData() {
    //stop baseline from adjusting to target
    if (app.betweenDetectionsFlag && app.useMagnetometer && app.dataPreProcessing == "delta") {
        //smooth and normalize for neural network model
        magNormal[0] = (Math.min(Math.max(app.lastMagReading.x, -179), 179) + 180) / 360;
        magNormal[1] = (Math.min(Math.max(app.lastMagReading.y, -179), 179) + 180) / 360;
        magNormal[2] = (Math.min(Math.max(app.lastMagReading.z, -179), 179) + 180) / 360;

        //delta values using delayed averages
        magDelta[0] = Math.abs(magNormal[0] - (Math.min(Math.max(magAvDelayed[0], -179), 179) + 180) / 360);
        magDelta[1] = Math.abs(magNormal[1] - (Math.min(Math.max(magAvDelayed[1], -179), 179) + 180) / 360);
        magDelta[2] = Math.abs(magNormal[2] - (Math.min(Math.max(magAvDelayed[2], -179), 179) + 180) / 360);
    } else {


        //add most recent data to history
        var assignLastMagReading = Object.assign({}, app.lastMagReading);
        app.magHistory.unshift(assignLastMagReading);

        //if we have enough data in history remove oldest data from history
        if (app.magHistory.length > app.magHistoryMax) {
            app.magHistory.pop();
        }


        //find averages from historical data
        var magAvTempX = [];
        var magAvTempY = [];
        var magAvTempZ = [];
        for (var i = 0; i < app.magHistory.length; i++) {
            magAvTempX.push(app.magHistory[i].x);
            magAvTempY.push(app.magHistory[i].y);
            magAvTempZ.push(app.magHistory[i].z);
        }

		if (app.magHistory.length > 3) {

	        magAv[0] = magAvTempX.reduce((previous, current) => current += previous) / magAvTempX.length;
	        magAv[1] = magAvTempY.reduce((previous, current) => current += previous) / magAvTempX.length;
	        magAv[2] = magAvTempZ.reduce((previous, current) => current += previous) / magAvTempX.length;

	        //smooth and normalize for neural network model
	        magNormal[0] = (Math.min(Math.max((app.magHistory[0].x + app.magHistory[1].x + app.magHistory[2].x) / 3, -179), 179) + 180) / 360;
	        magNormal[1] = (Math.min(Math.max((app.magHistory[0].y + app.magHistory[1].y + app.magHistory[2].y) / 3, -179), 179) + 180) / 360;
	        magNormal[2] = (Math.min(Math.max((app.magHistory[0].z + app.magHistory[1].z + app.magHistory[2].z) / 3, -179), 179) + 180) / 360;

            //find averages using oldest data
            var magAvDelayedTempX = magAvTempX.slice(Math.round(magAvTempX.length / 2), magAvTempX.length);
            var magAvDelayedTempY = magAvTempY.slice(Math.round(magAvTempY.length / 2), magAvTempY.length);
            var magAvDelayedTempZ = magAvTempZ.slice(Math.round(magAvTempZ.length / 2), magAvTempZ.length);

            magAvDelayed[0] = magAvDelayedTempX.reduce((previous, current) => current += previous) / magAvDelayedTempX.length;
            magAvDelayed[1] = magAvDelayedTempY.reduce((previous, current) => current += previous) / magAvDelayedTempY.length;
            magAvDelayed[2] = magAvDelayedTempZ.reduce((previous, current) => current += previous) / magAvDelayedTempZ.length;

            //delta values using delayed averages
            magDelta[0] = Math.abs(magNormal[0] - (Math.min(Math.max(magAvDelayed[0], -179), 179) + 180) / 360);
            magDelta[1] = Math.abs(magNormal[1] - (Math.min(Math.max(magAvDelayed[1], -179), 179) + 180) / 360);
            magDelta[2] = Math.abs(magNormal[2] - (Math.min(Math.max(magAvDelayed[2], -179), 179) + 180) / 360);
        }

    }
}


app.initialize();