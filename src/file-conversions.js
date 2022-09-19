import { brotli, temp_cache_dir, write_file_atomically } from "./utility.js";
import { Float16Array } from "@petamoriken/float16";
import { Buffer } from "buffer";
import { spawn } from "child_process";
import { readFile, rm, rename } from "fs/promises";
import { platform } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

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

export async function grib2_acc(input, options = {}) {
  await gfs_combine_grib(input, options, (a, b) => a - b);
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

export async function gfs_combine_grib(files, options = {}) {
  let out_file = join(temp_cache_dir, uuidv4());

  const cdo_sub_args = ["sub", files[0], files[1], out_file];

  await spawn_cmd("cdo", cdo_sub_args);

  if (options.factor) {
    let out = await cdo_multc(out_file, options.factor);
    await rm(out_file);
    out_file = out;
  }

  return out_file;
}

async function gfs_combine_grib_(input, output, options, combine_fn) {
  let arr = await grib2_to_arr(input, options.match, options.limit);

  let array = Array.from({ length: arr.length / 2 }, (_, i) => {
    let a = arr[i];
    let b = arr[i + arr.length / 2];
    a = is_magic_nan(a) ? NaN : a;
    b = is_magic_nan(b) ? NaN : b;
    return nan_for_glsl(isNaN, combine_fn(a, b), options.factor);
  });

  await write_array_to_file(output, array, options.compression_level);
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

  const gdalwarp_translate_args = [
    "-co",
    "COMPRESS=DEFLATE",
    "-co",
    "predictor=3",
    input,
    out_file,
  ];

  await spawn_cmd("gdal_translate", gdalwarp_translate_args);

  return out_file;
}

async function grib2_to_file(input, output, options) {
  let out_temp_file = join(temp_cache_dir, uuidv4());

  await spawn_cmd("wgrib2", [
    input,
    "-match",
    options.match,
    "-limit",
    options.limit,
    "-grib",
    out_temp_file,
  ]);

  if (options.clip_by) {
    console.log("Clipping");
    const out = await clip_grib(out_temp_file, output.options.clip_by);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (options.factor) {
    console.log("Multiply by factor");
    const out = await cdo_multc(out_temp_file, options.factor);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (options.asGeoTiff) {
    console.log("To Geotiff");
    const out = await grib_to_tiff(out_temp_file);
    await rm(out_temp_file);
    out_temp_file = out;
  }

  if (options.asGeoTiff) {
    console.log("Saving geotiff");
    return await rename(out_temp_file, output + ".geotiff");
  } else {
    console.log("Saving grib");
    return await rename(out_temp_file, output + ".grib");
  }
}

async function grib1_to_file(input, output, options = {}) {
  let out_temp_file = join(temp_cache_dir, uuidv4());

  const { record_number, clip_by, asGeoTiff, factor } = options;

  // create grib file for variable
  const wgrib_cmd = `wgrib ${input} | head -n ${
    record_number || 1
  } | wgrib -i ${input} -grib -o ${out_temp_file}`;
  const args = ["-c", wgrib_cmd];
  await spawn_cmd("sh", args);

  if (clip_by) {
    const out = await clip_grib(out_temp_file, clip_by);
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

async function grib2_to_arr(input, match = ".*", limit = 1) {
  let buffer = await spawn_cmd("wgrib2", [
    input,
    "-match",
    match,
    "-limit",
    limit,
    "-inv",
    devnull,
    "-bin",
    "-",
    "-no_header",
    "-order",
    "we:sn",
    "-ncpu",
    "1",
  ]);
  return typedarray_from_buffer(buffer, Float32Array);
}

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
