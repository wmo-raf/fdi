import { brotli, temp_cache_dir, write_file_atomically } from "./utility.js";
import { Float16Array } from "@petamoriken/float16";
import { Buffer } from "buffer";
import { spawn } from "child_process";
import { readFile, rm } from "fs/promises";
import { platform } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import util from "util";
import mv from "mv";

const rename = util.promisify(mv);

export async function grib1(input, output, options = {}) {
  return await grib1_to_file(input, output, options);
}

export async function grib1_normal(count, input, output, options = {}) {
  let arr = await grib1_to_arr(input, options.record_number);

  let length = arr.length / count;
  let array = Float64Array.from({ length }, (_, i) => {
    return (
      Array.from({ length: count }, (_, j) => {
        let v = arr[j * length + i];
        return is_magic_nan(v) ? NaN : v;
      }).reduce((a, b) => a + b) / count
    );
  });

  await write_file_atomically(output, array);
}

export async function grib1_anomaly(normal, input, output, options = {}) {
  let arr = await grib1_to_arr(input, options.record_number);
  let n_arr = await f64_to_arr(normal);

  let array = arr.map((v, i) => {
    v = is_magic_nan(v) ? NaN : v;
    return nan_for_glsl(isNaN, v - n_arr[i], options.factor);
  });

  await write_array_to_file(output, array, options.compression_level);
}

export async function grib2(input, output, options = { match: ".*" }) {
  await grib2_to_file(input, output, options);

  // let arr = await grib2_to_arr(input, options.match, options.limit);
  // let array = arr.map((v) => nan_for_glsl(is_magic_nan, v, options.factor));
  // await write_array_to_file(output, array, options.compression_level);
}

export async function grib2_speed(input, output, options = {}) {
  let out_file = join(temp_cache_dir, uuidv4());

  await grib2_to_file(input, out_file, {
    ...options,
    asGeoTiff: false,
    addExt: false,
  });

  const u_file = join(temp_cache_dir, uuidv4());

  await grib2_to_file(out_file, u_file, {
    match: options.uMatch,
    limit: 1,
    asGeoTiff: false,
    addExt: false,
  });

  const v_file = join(temp_cache_dir, uuidv4());

  await grib2_to_file(out_file, v_file, {
    match: options.vMatch,
    limit: 1,
    asGeoTiff: false,
    addExt: false,
  });

  const speed_file = await gfs_combine_grib(
    [u_file, v_file],
    options,
    "magnitude"
  );

  await grib2_to_file(speed_file, output, {
    ...options,
    extractGrib: false,
    clipBy: null,
    factor: null,
  });
}

export async function grib2_acc(input, options = {}) {
  await gfs_combine_grib(input, options, "subtract");
}

export async function netcdf(input, output, options = {}) {
  let arr = await netcdf_to_arr(input, options.variables);
  let array = arr.map((v) => nan_for_glsl(isNaN, v, options.factor));

  await write_array_to_file(output, array, options.compression_level);
}

export async function netcdf_speed(input, output, options = {}) {
  let [arrA, arrB] = await netcdf_to_arr(input, options.variables, false);

  let array = arrA.map((a, i) => {
    let v = Math.hypot(a, arrB[i]);
    return nan_for_glsl(isNaN, v, options.factor);
  });

  await write_array_to_file(output, array, options.compression_level);
}

export async function gfs_combine_grib(files, options = {}, combine_operation) {
  let out_file = join(temp_cache_dir, uuidv4());

  let args = [];

  if (!combine_operation || combine_operation === "subtract") {
    args = ["sub", files[0], files[1], out_file];
  } else if (combine_operation === "magnitude") {
    args = ["sqrt", "-add", "-sqr", files[0], "-sqr", files[1], out_file];
  } else {
    throw "Unsupported operation";
  }

  if (!!args.length) {
    await spawn_cmd("cdo", args);

    if (options.factor) {
      let out = await cdo_multc(out_file, options.factor);
      await rm(out_file);
      out_file = out;
    }

    return out_file;
  }
}

async function clip_grib(input, geom) {
  let out_file = join(temp_cache_dir, uuidv4());
  const gdalwarp_args = [
    "-q",
    "-cutline",
    geom,
    "-crop_to_cutline",
    "-of",
    "GRIB",
    "-dstnodata",
    -9999,
    "-overwrite",
    "-t_srs",
    "EPSG:4326",
    input,
    out_file,
  ];

  await spawn_cmd("gdalwarp", gdalwarp_args);

  return out_file;
}

async function cdo_multc(input, constant) {
  let out_file = join(temp_cache_dir, uuidv4());

  const cdo_multc_args = [`-mulc,${constant}`, input, out_file];
  await spawn_cmd("cdo", cdo_multc_args);

  return out_file;
}

async function grib_to_tiff(input) {
  let out_file = join(temp_cache_dir, uuidv4()) + ".tif";

  const gdal_translate_args = [
    "-co",
    "TILED=YES",
    "-co",
    "COMPRESS=LZW",
    "-co",
    "predictor=3",
    "-ot",
    "Float32",
    input,
    out_file,
  ];

  await spawn_cmd("gdal_translate", gdal_translate_args);

  return out_file;
}

async function grib2_to_file(input, output, options) {
  let out_temp_file;

  if (options.extractGrib !== undefined && options.extractGrib === false) {
    out_temp_file = input;
  } else {
    out_temp_file = join(temp_cache_dir, uuidv4());
    await spawn_cmd("wgrib2", [
      input,
      "-match",
      options.match,
      "-limit",
      options.limit,
      "-grib",
      out_temp_file,
    ]);
  }

  if (options.clipBy) {
    const out = await clip_grib(out_temp_file, options.clipBy);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (options.factor) {
    const out = await cdo_multc(out_temp_file, options.factor);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (options.asGeoTiff) {
    const out = await grib_to_tiff(out_temp_file);

    await rm(out_temp_file);
    out_temp_file = out;
  }

  if (options.asGeoTiff) {
    return await rename(out_temp_file, output + ".tif");
  } else {
    if (options.addExt === false) {
      return await rename(out_temp_file, output);
    } else {
      return await rename(out_temp_file, output + ".grib");
    }
  }
}

async function grib1_to_file(input, output, options = {}) {
  let out_temp_file = join(temp_cache_dir, uuidv4());

  const { record_number, clipBy, asGeoTiff, factor } = options;

  // create grib file for variable
  await spawn_cmd("wgrib", [
    input,
    "-d",
    record_number,
    "-grib",
    "-o",
    out_temp_file,
  ]);

  if (clipBy) {
    const out = await clip_grib(out_temp_file, clipBy);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (factor) {
    const out = await cdo_multc(out_temp_file, factor);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (asGeoTiff) {
    const out = await grib_to_tiff(out_temp_file);
    await rm(out_temp_file);
    out_temp_file = out;
  }

  if (asGeoTiff) {
    return await rename(out_temp_file, output + ".geotiff");
  } else {
    return await rename(out_temp_file, output + ".grib");
  }
}

async function grib1_to_arr(input, record_number = 1) {
  let temp_file = join(temp_cache_dir, uuidv4());
  await spawn_cmd("wgrib", [
    input,
    "-d",
    record_number,
    "-bin",
    "-nh",
    "-o",
    temp_file,
  ]);
  let buffer = await readFile(temp_file);
  await rm(temp_file);
  return typedarray_from_buffer(buffer, Float32Array);
}

async function f64_to_arr(input) {
  let buffer = await readFile(input);
  return typedarray_from_buffer(buffer, Float64Array);
}

const devnull = platform() === "win32" ? "NUL" : "/dev/null";

async function netcdf_to_arr(input, variables, flatten = true) {
  let buffer = await spawn_cmd("ncdump", [
    "-v",
    variables,
    "-p",
    "9,17",
    input,
  ]);
  let string = buffer.toString();
  let arrays = variables.split(",").map((v) => {
    return string
      .match(new RegExp(` ${v} =\n(.*?);`, "s"))[1]
      .split(",")
      .map((x) => parseFloat(x));
  });
  return flatten ? [].concat(...arrays) : arrays;
}

async function spawn_cmd(command, args) {
  return new Promise((resolve, reject) => {
    let child = spawn(command, args);

    let { stdout, stderr } = child;
    let chunks = [];
    let errs = [];

    stdout.on("data", (chunk) => chunks.push(chunk));
    stderr.on("data", (err) => errs.push(err));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        let msg = Buffer.concat(errs).toString();
        reject(`${command} exited with code ${code}:\n${msg}`);
      }
    });

    for (let obj of [child, stdout, stderr]) {
      obj.on("error", reject);
    }
  });
}

function is_magic_nan(val) {
  return val > 9.9989e20;
}

function nan_for_glsl(is_nan_fn, val, factor = 1) {
  return is_nan_fn(val) ? -Infinity : val * factor;
}

async function write_array_to_file(output, array, compression_level = 11) {
  let buffer = Buffer.from(new Float16Array(array).buffer);
  let compressed_buffer = await brotli(buffer, compression_level);

  await write_file_atomically(output, compressed_buffer);
}

function typedarray_from_buffer(buffer, type) {
  return new type(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / type.BYTES_PER_ELEMENT
  );
}
