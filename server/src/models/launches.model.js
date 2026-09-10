const axios = require('axios');

const launches = require('./launches.mongo');
const planets = require('./planets.mongo');

const DEFAULT_FLIGHT_NUMBER = 100;

// New working launch data API
const SPACE_LAUNCH_LIVE_URL =
  'https://spacelaunchlive.com/wp-json/sll/v1/launches';

async function getLatestFlightNumber() {
  const latestLaunch = await launches.findOne().sort('-flightNumber');

  if (!latestLaunch) {
    return DEFAULT_FLIGHT_NUMBER;
  }

  return latestLaunch.flightNumber;
}

/**
 * Convert Space Launch Live data into
 * the format used by our MongoDB schema.
 */
function convertLaunch(launchData, flightNumber) {
  const status = String(launchData.status || '').toUpperCase();

  let upcoming = true;
  let success = true;

  if (
    status === 'SUCCESS' ||
    status === 'FAILURE' ||
    status === 'PARTIAL'
  ) {
    upcoming = false;

    if (status === 'FAILURE') {
      success = false;
    }
  }

  return {
    flightNumber,
    mission:
      launchData.mission_name ||
      launchData.title ||
      'Unknown Mission',

    rocket:
      launchData.rocket_name ||
      'Unknown Rocket',

    launchDate: new Date(
      launchData.launch_date || Date.now()
    ),

    upcoming,

    success,

    customers: [],

    target: launchData.target_orbit || undefined,
  };
}

/**
 * Download SpaceX launch data and save it to MongoDB.
 */
async function populateLaunches() {
  console.log('Downloading launch data...');

  try {
    // Get upcoming SpaceX launches
    const upcomingResponse = await axios.get(SPACE_LAUNCH_LIVE_URL, {
      params: {
        search: 'spacex',
        mode: 'upcoming',
        per_page: 50,
      },
      timeout: 15000,
    });

    // Get previous SpaceX launches
    const previousResponse = await axios.get(SPACE_LAUNCH_LIVE_URL, {
      params: {
        search: 'spacex',
        mode: 'previous',
        per_page: 50,
      },
      timeout: 15000,
    });

    const upcomingLaunches = extractLaunches(upcomingResponse.data);
    const previousLaunches = extractLaunches(previousResponse.data);

    const allLaunches = [
      ...previousLaunches,
      ...upcomingLaunches,
    ];

    if (allLaunches.length === 0) {
      throw new Error('No SpaceX launches were returned by the API.');
    }

    console.log(`Found ${allLaunches.length} SpaceX launches.`);

    // Start flight numbers from 1
    let flightNumber = 1;

    for (const launchData of allLaunches) {
      const launch = convertLaunch(launchData, flightNumber);

      console.log(
        `${launch.flightNumber} - ${launch.mission}`
      );

      await saveLaunch(launch);

      flightNumber++;
    }

    console.log('Launch data successfully saved to MongoDB.');
  } catch (error) {
    console.error('Problem downloading launch data.');

    if (error.response) {
      console.error(
        `API responded with status ${error.response.status}`
      );

      console.error(error.response.data);
    } else {
      console.error(error.message);
    }

    throw new Error('Launch data download failed!');
  }
}

/**
 * Different API versions can return the
 * launch array in different properties.
 */
function extractLaunches(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.launches)) {
    return data.launches;
  }

  if (Array.isArray(data.results)) {
    return data.results;
  }

  if (Array.isArray(data.data)) {
    return data.data;
  }

  return [];
}

async function findLaunch(filter) {
  return await launches.findOne(filter);
}

async function loadLaunchData() {
  // Instead of checking specifically for Falcon 1,
  // simply check whether MongoDB already contains launches.

  const existingLaunch = await launches.findOne();

  if (existingLaunch) {
    return console.log('Launch data already loaded!');
  }

  await populateLaunches();
}

async function getAllLaunches(skip, limit) {
  return await launches
    .find({}, { _id: 0, __v: 0 })
    .sort({ flightNumber: 1 })
    .skip(skip)
    .limit(limit);
}

async function saveLaunch(launch) {
  await launches.findOneAndUpdate(
    { flightNumber: launch.flightNumber },
    launch,
    {
      upsert: true,
      new: true,
    }
  );
}

async function findLaunchById(id) {
  return await findLaunch({ flightNumber: id });
}

async function scheduleNewLaunch(launch) {
  const latestFlightNumber = await getLatestFlightNumber();

  const planet = await planets.findOne({
    keplerName: launch.target,
  });

  if (!planet) {
    throw new Error('No matching planet found!');
  }

  const newLaunch = Object.assign(launch, {
    flightNumber: latestFlightNumber + 1,
    target: planet.keplerName,
    upcoming: true,
    success: true,
    customers: ['Zero to Mastery', 'NASA'],
  });

  await saveLaunch(newLaunch);
}

async function abortLaunchById(launchId) {
  const aborted = await launches.updateOne(
    { flightNumber: launchId },
    {
      upcoming: false,
      success: false,
    }
  );

  return aborted.modifiedCount === 1;
}

module.exports = {
  loadLaunchData,
  getAllLaunches,
  findLaunchById,
  scheduleNewLaunch,
  abortLaunchById,
};

