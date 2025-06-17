'use strict';

let gl; // Контекст WebGL.
let surface; // Модель поверхні для відображення.
let soundSourceModel; // Модель сфери, що представляє джерело звуку.
let shProgram; // Шейдерна програма.
let spaceball; // Об'єкт TrackballRotator для обертання вигляду за допомогою миші.
let stereoCam; // Об'єкт, що містить стереокамеру та її параметри.

let sensorRotationMatrix = m4.identity(); // Матриця обертання, отримана з даних сенсора (гіроскопа).
let soundSourceRotationMatrix = m4.identity(); // Матриця обертання для візуального джерела звуку.

// Змінні Web Audio API
let audioContext; // Аудіо контекст для обробки звуку.
let panner; // PannerNode для просторового позиціонування звуку.
let biquadFilter; // BiquadFilterNode для застосування аудіофільтрів.
let audioBufferSource; // AudioBufferSourceNode для відтворення аудіоданих.
let sourceGainNode; // GainNode для контролю гучності джерела звуку.
let audioReady = false; // Прапорець, що вказує, чи готовий аудіофайл до відтворення.
let audioPlaying = false; // Прапорець, що вказує, чи відтворюється аудіо.

/**
 * Конструктор ShaderProgram для керування шейдерною програмою та розташуванням її змінних.
 * @param {string} name Назва програми.
 * @param {WebGLProgram} program WebGL програма.
 */
function ShaderProgram(name, program) {
    this.name = name;
    this.prog = program;

    // Розташування атрибута для позицій вершин у шейдері.
    this.iAttribVertex = -1;
    // Розташування уніформи для кольору в шейдері.
    this.iColor = -1;
    // Розташування уніформи для комбінованої матриці трансформації (більше не використовується безпосередньо).
    this.iModelViewProjectionMatrix = -1;
    // Розташування уніформи для матриці виду моделі.
    this.iModelViewMatrix = -1;
    // Розташування уніформи для матриці проекції.
    this.iProjectionMatrix = -1;

    /**
     * Активує використання цієї шейдерної програми.
     */
    this.Use = function() {
        gl.useProgram(this.prog);
    }
}

let lastTimestamp = null; // Часова мітка останнього отриманого пакета даних сенсора.
let connectButton = document.getElementById('connectButton'); // Кнопка для підключення до сенсора.
let statusMessage = document.getElementById('statusMessage'); // Елемент для відображення статусу підключення.
let playPauseButton = document.getElementById('playPauseButton'); // Кнопка для відтворення/паузи аудіо.
let audioFileInput = document.getElementById('audioFile'); // Ввід для вибору аудіофайлу.
let enableFilterCheckbox = document.getElementById('enableFilter'); // Чекбокс для увімкнення/вимкнення фільтра.
let filterFrequencyInput = document.getElementById('filterFrequency'); // Повзунок для частоти фільтра.
let filterGainInput = document.getElementById('filterGain'); // Повзунок для підсилення фільтра.
let filterQInput = document.getElementById('filterQ'); // Повзунок для Q-фактора фільтра.

/**
 * Отримує IP-адресу сенсора з HTML-поля введення та підключається до сенсорного сервера.
 */
function connectSensorFromInput() {
    let deviceType = document.getElementById('deviceType').value;
    let sensorAddress = document.getElementById('sensorAddress').value;
    console.log("Тип пристрою: " + deviceType);
    let address = sensorAddress;

    // Формування адреси WebSocket залежно від типу пристрою.
    if (deviceType === "android") {
        address = "ws://" + sensorAddress + "/sensor/connect?type=android.sensor.gyroscope";
        console.log("Підключення до Android сенсора за адресою " + address);
    } else {
        // Для iOS припускається, що міст Node.js працює на localhost:3000.
        address = "ws://localhost:3000";
        console.log("Підключення до мосту сенсора iOS за адресою " + address);
    }
    connectSensorServer(address);
    connectButton.disabled = true; // Вимкнути кнопку після натискання.
    connectButton.textContent = "Connecting...";
}

/**
 * Підключається до сенсорного сервера через WebSocket та обробляє дані гіроскопа.
 * @param {string} sensorIp IP-адреса або URL сенсорного сервера.
 */
function connectSensorServer(sensorIp) {
    // Якщо IP-адреса не надана, не підключатися.
    if (!sensorIp) return;

    let ws = new WebSocket(sensorIp);

    // Обробник події відкритого з'єднання.
    ws.onopen = function() {
        console.log("Підключено до сенсорного сервера");
        connectButton.disabled = true; // Вимкнути кнопку після підключення.
        connectButton.textContent = "Connected!";
        statusMessage.textContent = "Status: Connected to" + sensorIp;

        // Відновлюємо AudioContext при взаємодії з користувачем (підключення до сенсора)
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log("AudioContext успішно відновлено.");
                draw(); // Перемалювати після готовності аудіоконтексту.
            }).catch(e => console.error("Помилка відновлення AudioContext:", e));
        } else {
            draw(); // Перемалювати сцену.
        }
    };

    // Обробник події отримання повідомлення від сервера.
    ws.onmessage = function(event) {
        try {
            let sensorData = JSON.parse(event.data);
            console.log("Отримані дані сенсора:", sensorData);

            // Перевірка наявності даних та часової мітки.
            if (sensorData.values && typeof sensorData.timestamp !== "undefined") {
                let currentTimestamp = sensorData.timestamp;

                // Ініціалізація lastTimestamp при першому отриманні даних.
                if (lastTimestamp === null) {
                    lastTimestamp = currentTimestamp;
                    return;
                }

                // Обчислення різниці часу між показаннями.
                let dt = (currentTimestamp - lastTimestamp) / 1e9; // Перетворити наносекунди в секунди.
                lastTimestamp = currentTimestamp;

                let values = sensorData.values; // Дані гіроскопа [wx, wy, wz] в радіанах/сек.

                // Перестановка осей для відповідності системі координат додатка:
                // x залишається x, y стає z, z стає -y.
                let wx = values[0],
                    wy = values[2],
                    wz = -values[1];

                let angularSpeed = Math.sqrt(wx * wx + wy * wy + wz * wz);

                // Оновлення матриці обертання, якщо є кутова швидкість.
                if (angularSpeed > 0) {
                    let angle = angularSpeed * dt;
                    let axis = [wx / angularSpeed, wy / angularSpeed, wz / angularSpeed];
                    let incRotation = m4.axisRotation(axis, angle); // Матриця приросту обертання.
                    // Застосувати обертання до матриці джерела звуку.
                    soundSourceRotationMatrix = m4.multiply(incRotation, soundSourceRotationMatrix);

                    // Оновлюємо орієнтацію PannerNode, якщо AudioContext працює і panner визначений.
                    if (panner && audioContext && audioContext.state === 'running' && audioContext.currentTime > 0) {
                        // Витягуємо вектор "вперед" з матриці обертання джерела звуку.
                        let forwardX = -soundSourceRotationMatrix[8]; // -Z з матриці [2][0]
                        let forwardY = -soundSourceRotationMatrix[9]; // -Z з матриці [2][1]
                        let forwardZ = -soundSourceRotationMatrix[10]; // -Z з матриці [2][2]

                        // Витягуємо вектор "вгору" для повної орієнтації.
                        let upX = soundSourceRotationMatrix[4]; // Y з матриці [1][0]
                        let upY = soundSourceRotationMatrix[5]; // Y з матриці [1][1]
                        let upZ = soundSourceRotationMatrix[6]; // Y з матриці [1][2]

                        // Переконуємось, що властивості AudioParam існують, перш ніж встановлювати значення.
                        if (panner.orientationX && panner.orientationY && panner.orientationZ &&
                            panner.upX && panner.upY && panner.upZ) {
                            panner.orientationX.setValueAtTime(forwardX, audioContext.currentTime);
                            panner.orientationY.setValueAtTime(forwardY, audioContext.currentTime);
                            panner.orientationZ.setValueAtTime(forwardZ, audioContext.currentTime);
                            panner.upX.setValueAtTime(upX, audioContext.currentTime);
                            panner.upY.setValueAtTime(upY, audioContext.currentTime);
                            panner.upZ.setValueAtTime(upZ, audioContext.currentTime);
                        } else {
                            console.warn("Властивості орієнтації Panner не повністю визначені, або currentTime дорівнює 0.");
                        }
                    }
                }
                draw(); // Перемалювати сцену після оновлення даних сенсора.
            }
        } catch (e) {
            console.error("Помилка обробки даних сенсора:", e);
        }
    };

    // Обробник події помилки WebSocket.
    ws.onerror = function(err) {
        console.error("Помилка WebSocket:", err);
    };

    // Обробник події закритого з'єднання.
    ws.onclose = function() {
        console.log("З'єднання з сенсорним сервером закрито");
        connectButton.disabled = false; // Знову увімкнути кнопку після закриття.
        connectButton.textContent = "Connect Sensor";
        statusMessage.textContent = "Status: Not connected";
    }
}

/**
 * Основна функція малювання. Рендерить сцену для обох очей (стереоефект).
 */
function draw() {
    gl.clearColor(0, 0, 0, 0); // Встановити колір очищення (чорний, повністю прозорий).
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // Очистити буфери кольору та глибини.

    shProgram.Use(); // Активувати шейдерну програму.

    // Отримуємо матрицю вигляду з TrackballRotator (це буде для камери, переглядача сцени).
    let modelView = spaceball.getViewMatrix();
    
    // Трансформація для моделі поверхні (залишається відносно нерухомою).
    let surfaceBaseTransform = m4.translation(0, 0, -15); // Переміщуємо поверхню по Z.
    let surfaceModelMatrix = m4.multiply(surfaceBaseTransform, modelView); // Об'єднуємо з матрицею виду.

    // Трансформація для моделі джерела звуку (сфери).
    const surfaceCenterX = 0;
    const surfaceCenterY = 0;
    const surfaceCenterZ = -15; // Z-координата центру поверхні (така ж, як і трансляція surfaceBaseTransform).
    const sphereOrbitRadius = 3; // Відстань сфери від центру обертання.
    const sphereVisualizationScale = 0.5; // Візуальний масштаб сфери.

    let soundSourceOrbitTransform = m4.identity(); // Початкова матриця трансформації для сфери.

    // Перемістити до центру поверхні (точка обертання для орбіти).
    soundSourceOrbitTransform = m4.translate(soundSourceOrbitTransform, surfaceCenterX, surfaceCenterY, surfaceCenterZ);

    // Застосувати обертання сенсора (це обертає систему координат навколо точки обертання).
    soundSourceOrbitTransform = m4.multiply(soundSourceRotationMatrix, soundSourceOrbitTransform);

    // Перемістити сферу вздовж однієї осі на радіус її орбіти, щоб вона оберталася навколо центру.
    soundSourceOrbitTransform = m4.translate(soundSourceOrbitTransform, 0, 0, sphereOrbitRadius);

    // Застосувати візуальний масштаб до сфери.
    soundSourceOrbitTransform = m4.scale(soundSourceOrbitTransform, sphereVisualizationScale, sphereVisualizationScale, sphereVisualizationScale);

    // Об'єднати з матрицею вигляду камери для остаточного відображення.
    let soundSourceModelView = m4.multiply(soundSourceOrbitTransform, modelView);

    // Оновлюємо позицію PannerNode в Web Audio API на основі візуалізованої позиції джерела звуку.
    if (panner && audioReady && audioContext && audioContext.state === 'running' && audioContext.currentTime > 0) {
        // Перетворити локальну позицію (0,0,0) джерела звуку у світові координати.
        let pannerWorldPosition = m4.transformPoint(soundSourceOrbitTransform, [0, 0, 0]);

        // Оновлюємо позицію PannerNode.
        if (panner.positionX && panner.positionY && panner.positionZ) {
            panner.positionX.setValueAtTime(pannerWorldPosition[0], audioContext.currentTime);
            panner.positionY.setValueAtTime(pannerWorldPosition[1], audioContext.currentTime);
            panner.positionZ.setValueAtTime(pannerWorldPosition[2], audioContext.currentTime);

            // Забезпечуємо повну гучність джерела звуку через sourceGainNode.
            if (sourceGainNode && sourceGainNode.gain) {
                sourceGainNode.gain.setValueAtTime(1.0, audioContext.currentTime);
            }
        } else {
            console.warn("Властивості позиції Panner не повністю визначені, або currentTime дорівнює 0.");
        }
    }


    // Перший прохід (ліве око).
    let matrLeftFrustum = stereoCam.calcLeftFrustum(); // Обчислити матрицю проекції для лівого ока.
    gl.uniformMatrix4fv(shProgram.iProjectionMatrix, false, matrLeftFrustum); // Завантажити матрицю проекції в шейдер.
    let translateLeftEye = m4.translation(stereoCam.eyeSeparation / 2, 0, 0); // Зміщення для лівого ока.

    // Малюємо поверхню для лівого ока.
    surface.Bind(); // Прив'язуємо буфери поверхні.
    let matAccumSurfaceLeft = m4.multiply(translateLeftEye, surfaceModelMatrix); // Обчислити матрицю виду моделі для поверхні.
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, matAccumSurfaceLeft); // Завантажити матрицю виду моделі в шейдер.
    gl.colorMask(true, false, false, true); // Малюємо тільки в червоний канал (для анагліфа).
    gl.uniform4fv(shProgram.iColor, [1, 1, 1, 1]); // Встановити білий колір для поверхні.
    surface.Draw(); // Малюємо суцільну поверхню.
    gl.uniform4fv(shProgram.iColor, [0, 0, 0, 1]); // Встановити чорний колір для каркасу.
    surface.DrawWireframe(); // Малюємо каркас поверхні.

    // Малюємо сферу джерела звуку для лівого ока.
    soundSourceModel.Bind(); // Прив'язуємо буфери сфери.
    let matAccumSoundLeft = m4.multiply(translateLeftEye, soundSourceModelView); // Обчислити матрицю виду моделі для сфери.
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, matAccumSoundLeft); // Завантажити матрицю виду моделі в шейдер.
    gl.uniform4fv(shProgram.iColor, [1.0, 0.0, 0.0, 1.0]); // Встановити червоний колір для сфери.
    soundSourceModel.Draw(); // Малюємо суцільну сферу.
    gl.uniform4fv(shProgram.iColor, [0.0, 0.0, 0.0, 1.0]); // Встановити чорний колір для каркасу.
    soundSourceModel.DrawWireframe(); // Малюємо каркас сфери.


    // Другий прохід (праве око).
    gl.clear(gl.DEPTH_BUFFER_BIT); // Очищуємо буфер глибини тільки для другого ока.
    let matrRightFrustum = stereoCam.calcRightFrustum(); // Обчислити матрицю проекції для правого ока.
    gl.uniformMatrix4fv(shProgram.iProjectionMatrix, false, matrRightFrustum); // Завантажити матрицю проекції в шейдер.
    let translateRightEye = m4.translation(-stereoCam.eyeSeparation / 2, 0, 0); // Зміщення для правого ока.

    // Малюємо поверхню для правого ока.
    surface.Bind(); // Знову прив'язуємо буфери поверхні.
    let matAccumSurfaceRight = m4.multiply(translateRightEye, surfaceModelMatrix); // Обчислити матрицю виду моделі для поверхні.
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, matAccumSurfaceRight); // Завантажити матрицю виду моделі в шейдер.
    gl.colorMask(false, true, true, true); // Малюємо тільки в зелений та синій канали.
    gl.uniform4fv(shProgram.iColor, [1, 1, 1, 1]); // Встановити білий колір для поверхні.
    surface.Draw(); // Малюємо суцільну поверхню.
    gl.uniform4fv(shProgram.iColor, [0, 0, 0, 1]); // Встановити чорний колір для каркасу.
    surface.DrawWireframe(); // Малюємо каркас поверхні.

    // Малюємо сферу джерела звуку для правого ока.
    soundSourceModel.Bind(); // Знову прив'язуємо буфери сфери.
    let matAccumSoundRight = m4.multiply(translateRightEye, soundSourceModelView); // Обчислити матрицю виду моделі для сфери.
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, matAccumSoundRight); // Завантажити матрицю виду моделі в шейдер.
    gl.uniform4fv(shProgram.iColor, [0.0, 1.0, 1.0, 1.0]); // Встановити блакитний колір для сфери.
    soundSourceModel.Draw(); // Малюємо суцільну сферу.
    gl.uniform4fv(shProgram.iColor, [0.0, 0.0, 0.0, 1.0]); // Встановити чорний колір для каркасу.
    soundSourceModel.DrawWireframe(); // Малюємо каркас сфери.

    gl.colorMask(true, true, true, true); // Відновити маску кольору для всіх каналів.
}

/**
 * Ініціалізує контекст WebGL та об'єкти сцени. Викликається з init().
 */
function initGL() {
    let prog = createProgram(gl, vertexShaderSource, fragmentShaderSource); // Створити шейдерну програму.
    shProgram = new ShaderProgram('Basic', prog); // Ініціалізувати об'єкт ShaderProgram.
    shProgram.Use(); // Активувати шейдерну програму.

    // Отримати розташування змінних шейдера.
    shProgram.iAttribVertex = gl.getAttribLocation(prog, "vertex");
    shProgram.iModelViewMatrix = gl.getUniformLocation(prog, "ModelViewMatrix");
    shProgram.iProjectionMatrix = gl.getUniformLocation(prog, "ProjectionMatrix");
    shProgram.iColor = gl.getUniformLocation(prog, "color");

    // Створюємо геометрію поверхні (залишається нерухомою).
    let surfaceData = CreateSurfaceData(50, 50); // Генерувати дані вершин та індексів для поверхні.
    surface = new Model('Surface'); // Створити об'єкт моделі.
    surface.BufferData(surfaceData.verticesF32, surfaceData.indicesU16); // Забуферувати дані моделі.

    // Створюємо геометрію сфери для візуалізації джерела звуку.
    let sphereData = CreateSphereData(20, 20); // 20 сегментів, 20 кілець для деталізації сфери.
    soundSourceModel = new Model('SoundSourceSphere'); // Створити об'єкт моделі для сфери.
    soundSourceModel.BufferData(sphereData.verticesF32, sphereData.indicesU16); // Забуферувати дані сфери.

    // Ініціалізуємо параметри стереокамери.
    stereoCam = new StereoCamera(
        0.7, // Розділення очей (дециметри).
        14.0, // Зведення (дециметри).
        gl.canvas.width / gl.canvas.height, // Співвідношення сторін канвасу.
        1.0, // Поле зору (радіани).
        8.0, // Ближня площина відсікання (дециметри).
        20.0 // Дальня площина відсікання (дециметри).
    );

    gl.enable(gl.DEPTH_TEST); // Увімкнути тест глибини для коректного відображення 3D-об'єктів.

    initAudio(); // Ініціалізувати Web Audio API компоненти.
}

/**
 * Ініціалізує компоненти Web Audio API та налаштовує маршрутизацію звуку.
 */
async function initAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)(); // Створити AudioContext.

    // Створюємо PannerNode для просторового позиціонування звуку.
    panner = audioContext.createPanner();
    panner.panningModel = 'HRTF'; // Модель панорамування (Head-Related Transfer Function) для реалістичного просторового звуку.
    panner.distanceModel = 'inverse'; // Як гучність зменшується з відстанню.
    panner.refDistance = 12; // Відстань, на якій гучність не зменшується.
    panner.maxDistance = 20; // Відстань, після якої звук стає дуже тихим.
    panner.rolloffFactor = 1; // Коефіцієнт зменшення гучності з відстанню.

    // Властивості конуса PannerNode (для спрямованого звуку).
    panner.coneInnerAngle = 360; // Звук чути однаково з усіх напрямків.
    panner.coneOuterAngle = 0; // За межами внутрішнього конуса гучність не зменшується.
    panner.coneOuterGain = 0; // Гучність поза зовнішнім конусом.

    // Створюємо новий GainNode для загального контролю гучності джерела.
    sourceGainNode = audioContext.createGain();
    sourceGainNode.gain.value = 1; // Починаємо з повної гучності.

    // Встановлюємо початкову позицію слухача (камери) у світових координатах.
    // Слухач знаходиться у світовому початку координат і дивиться вздовж негативної осі Z.
    audioContext.listener.positionX.setValueAtTime(0, audioContext.currentTime);
    audioContext.listener.positionY.setValueAtTime(0, audioContext.currentTime);
    audioContext.listener.positionZ.setValueAtTime(0, audioContext.currentTime);
    audioContext.listener.forwardX.setValueAtTime(0, audioContext.currentTime);
    audioContext.listener.forwardY.setValueAtTime(0, audioContext.currentTime);
    audioContext.listener.forwardZ.setValueAtTime(-1, audioContext.currentTime);
    audioContext.listener.upX.setValueAtTime(0, audioContext.currentTime);
    audioContext.listener.upY.setValueAtTime(1, audioContext.currentTime);
    audioContext.listener.upZ.setValueAtTime(0, audioContext.currentTime);

    // Створюємо BiquadFilterNode (фільтр Low-Shelf).
    biquadFilter = audioContext.createBiquadFilter();
    biquadFilter.type = 'lowshelf'; // Тип фільтра (збільшення/зменшення низьких частот).
    updateFilterParameters(); // Встановлюємо початкові параметри фільтра з HTML-вводів.
    biquadFilter.gain.value = 0; // Починаємо з вимкненим фільтром (без зміни гучності).

    // Додаємо слухача подій для вибору аудіофайлу.
    audioFileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            playPauseButton.disabled = true;
            playPauseButton.textContent = "Loading...";
            const arrayBuffer = await file.arrayBuffer(); // Зчитати файл як ArrayBuffer.
            audioContext.decodeAudioData(arrayBuffer, (buffer) => { // Декодувати аудіодані.
                // Якщо джерело вже існує і відтворюється, зупиняємо його перед завантаженням нового.
                if (audioBufferSource && audioPlaying) {
                    audioBufferSource.stop();
                    audioPlaying = false;
                }
                audioBufferSource = audioContext.createBufferSource(); // Створити нове джерело буфера.
                audioBufferSource.buffer = buffer; // Призначити декодований буфер.
                audioBufferSource.loop = true; // Зациклити відтворення.

                // Підключаємо джерело до графа аудіонод:
                // Source -> sourceGainNode -> biquadFilter -> panner -> AudioContext.destination
                audioBufferSource.connect(sourceGainNode);
                sourceGainNode.connect(biquadFilter);
                biquadFilter.connect(panner);
                panner.connect(audioContext.destination);

                audioReady = true; // Аудіо готове до відтворення.
                playPauseButton.disabled = false;
                playPauseButton.textContent ="Play"; 

                // Обробник події закінчення відтворення (для зациклення).
                audioBufferSource.onended = () => {
                    audioPlaying = false;
                    playPauseButton.textContent = "Play";
                };

            }, (e) => {
                console.error("Помилка декодування аудіоданих:", e);
                playPauseButton.disabled = true;
                playPauseButton.textContent = "Помилка завантаження";
            });
        }
    });

    // Додаємо слухачів подій для кнопок та повзунків.
    playPauseButton.addEventListener('click', toggleAudioPlayback);
    enableFilterCheckbox.addEventListener('change', toggleFilter);
    filterFrequencyInput.addEventListener('input', updateFilterParameters);
    filterGainInput.addEventListener('input', updateFilterParameters);

    // Початкове оновлення дисплеїв параметрів фільтра.
    updateFilterParameters();
}

/**
 * Перемикає відтворення аудіо: відтворює або зупиняє аудіо в залежності від його поточного стану.
 */
function toggleAudioPlayback() {
    if (!audioReady) {
        console.warn("Аудіо не готове до відтворення. Спочатку виберіть файл.");
        return;
    }

    if (audioPlaying) {
        // Якщо аудіо відтворюється, зупинити його.
        if (audioBufferSource) {
            audioBufferSource.stop();
            audioPlaying = false;
            playPauseButton.textContent = "Play";
            // Повторно створюємо AudioBufferSourceNode, якщо хочемо відтворити знову після зупинки,
            // оскільки 'stop()' робить AudioBufferSourceNode непридатним для подальшого використання.
            const currentBuffer = audioBufferSource.buffer; // Зберігаємо поточний буфер.
            audioBufferSource = audioContext.createBufferSource();
            audioBufferSource.buffer = currentBuffer;
            audioBufferSource.loop = true;
            // Перепідключаємо вузли в аудіографі.
            audioBufferSource.connect(sourceGainNode);
            sourceGainNode.connect(biquadFilter);
            biquadFilter.connect(panner);
            panner.connect(audioContext.destination);
        }
    } else {
        // Якщо аудіо не відтворюється, почати відтворення.
        if (audioBufferSource) {
            // Якщо контекст був призупинений, відновлюємо його (потрібно для взаємодії з користувачем).
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            audioBufferSource.start(0); // Починаємо відтворення з початку.
            audioPlaying = true;
            playPauseButton.textContent = "Stop";
        } else {
            console.warn("Немає доступного джерела аудіобуфера. Спочатку виберіть файл.");
        }
    }
}

/**
 * Перемикає фільтр на основі стану чекбоксу та оновлює параметри фільтра.
 */
function toggleFilter() {
    if (!biquadFilter) return;

    if (enableFilterCheckbox.checked) {
        // Фільтр увімкнено, застосовуємо поточні параметри з повзунків.
        updateFilterParameters();
    } else {
        // Фільтр вимкнено, встановлюємо посилення на 0 (рівна АЧХ), щоб він не впливав на звук.
        biquadFilter.gain.setValueAtTime(0, audioContext.currentTime);
    }
}

/**
 * Оновлює параметри фільтра (частоту, підсилення, Q-фактор) на основі значень з полів вводу
 * та встановлює їх у BiquadFilterNode.
 */
function updateFilterParameters() {
    if (!biquadFilter) return;

    const frequency = parseFloat(filterFrequencyInput.value);
    const gain = parseFloat(filterGainInput.value);

    // Оновлюємо текстові значення поруч із повзунками.
    document.getElementById('filterFrequencyValue').textContent = `${frequency} Hz`;
    document.getElementById('filterGainValue').textContent = `${gain} dB`;

    if (enableFilterCheckbox.checked) {
        // Якщо фільтр увімкнено, застосовуємо значення з повзунків до BiquadFilterNode.
        biquadFilter.frequency.setValueAtTime(frequency, audioContext.currentTime);
        biquadFilter.gain.setValueAtTime(gain, audioContext.currentTime);
    } else {
        // Якщо фільтр вимкнено, посилення має бути 0 незалежно від положення повзунка.
        biquadFilter.gain.setValueAtTime(0, audioContext.currentTime);
    }
}

/**
 * Компілює та компонує вершинний та фрагментний шейдери в програму WebGL.
 * @param {WebGLRenderingContext} gl Контекст WebGL.
 * @param {string} vShader Джерельний код вершинного шейдера.
 * @param {string} fShader Джерельний код фрагментного шейдера.
 * @returns {WebGLProgram} Скомпільована та скомпонована програма.
 * @throws {Error} Якщо виникає помилка компіляції або компонування шейдерів.
 */
function createProgram(gl, vShader, fShader) {
    let vsh = gl.createShader(gl.VERTEX_SHADER); // Створити вершинний шейдер.
    gl.shaderSource(vsh, vShader); // Призначити джерельний код.
    gl.compileShader(vsh); // Скомпілювати шейдер.
    if (!gl.getShaderParameter(vsh, gl.COMPILE_STATUS)) {
        throw new Error("Помилка у вершинному шейдері: " + gl.getShaderInfoLog(vsh));
    }
    let fsh = gl.createShader(gl.FRAGMENT_SHADER); // Створити фрагментний шейдер.
    gl.shaderSource(fsh, fShader); // Призначити джерельний код.
    gl.compileShader(fsh); // Скомпілювати шейдер.
    if (!gl.getShaderParameter(fsh, gl.COMPILE_STATUS)) {
        throw new Error("Помилка у фрагментному шейдері: " + gl.getShaderInfoLog(fsh));
    }
    let prog = gl.createProgram(); // Створити програму.
    gl.attachShader(prog, vsh); // Приєднати вершинний шейдер.
    gl.attachShader(prog, fsh); // Приєднати фрагментний шейдер.
    gl.linkProgram(prog); // Скомпонувати програму.
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("Помилка зв'язування у програмі: " + gl.getProgramInfoLog(prog));
    }
    return prog; // Повернути скомпоновану програму.
}

/**
 * Оновлює параметри стереокамери з HTML-полів введення.
 */
function updateStereoParams() {
    // Отримати значення параметрів з повзунків та оновити об'єкт стереокамери.
    stereoCam.eyeSeparation = parseFloat(document.getElementById('eyeSeparation').value);
    stereoCam.fov = parseFloat(document.getElementById('fov').value);
    stereoCam.near = parseFloat(document.getElementById('near').value);
    stereoCam.convergence = parseFloat(document.getElementById('convergence').value);

    // Оновити текстові значення поруч із повзунками.
    document.getElementById('eyeSeparationValue').textContent = stereoCam.eyeSeparation;
    document.getElementById('fovValue').textContent = stereoCam.fov;
    document.getElementById('nearValue').textContent = stereoCam.near;
    document.getElementById('convergenceValue').textContent = stereoCam.convergence;
    draw(); // Перемалювати сцену з новими параметрами.
}

// Додаємо слухачів подій до повзунків параметрів стерео.
['eyeSeparation', 'fov', 'near', 'convergence'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', updateStereoParams);
});

// Якщо елемент веб-камери існує, намагаємося запустити потік веб-камери.
if (document.getElementById('webcam')) {
    navigator.mediaDevices.getUserMedia({ video: true }).then(function(stream) {
        document.getElementById('webcam').srcObject = stream;
    }).catch(function(err) {
        document.getElementById('webcam').style.display = 'none';
        console.error("Доступ до веб-камери заборонено:", err);
    });
}

/**
 * Перемикає доступність поля введення IP-адреси сенсора в залежності від типу пристрою.
 */
function toggleSensorAddressInput() {
    var deviceType = document.getElementById('deviceType').value;
    var sensorInput = document.getElementById('sensorAddress');
    // Вимкнути поле введення, якщо вибрано 'ios', оскільки воно використовує локальний проксі.
    sensorInput.disabled = (deviceType === 'ios');
}

/**
 * Функція ініціалізації, яка буде викликана при завантаженні сторінки.
 * Встановлює контекст WebGL, ініціалізує сцену та обробники подій.
 */
function init() {
    let canvas;
    try {
        canvas = document.getElementById("webglcanvas");
        gl = canvas.getContext("webgl"); // Отримати контекст WebGL.
        if (!gl) {
            throw "Браузер не підтримує WebGL";
        }
    } catch (e) {
        document.getElementById("canvas-holder").innerHTML =
            "<p>Вибачте, не вдалося отримати графічний контекст WebGL.</p>";
        return;
    }
    try {
        initGL(); // Ініціалізувати графічний контекст WebGL та сцену.
    } catch (e) {
        document.getElementById("canvas-holder").innerHTML =
            "<p>Вибачте, не вдалося ініціалізувати графічний контекст WebGL: " + e + "</p>";
        return;
    }

    // Ініціалізуємо TrackballRotator для обертання вигляду за допомогою миші.
    // Поверхня буде нерухомою, але камеру все ще можна переміщати мишею.
    spaceball = new TrackballRotator(canvas, draw, 0);
    updateStereoParams(); // Оновити параметри стереокамери за початковими значеннями.
    toggleSensorAddressInput(); // Встановити початковий стан поля вводу адреси сенсора.

    draw(); // Виконати перше малювання сцени.
}
