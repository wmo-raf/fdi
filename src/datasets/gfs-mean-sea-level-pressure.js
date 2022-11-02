export const name = `mean sea level pressure`;

export const metadata = {
  unit: "hPa",
};

export const grib2_options = {
  match: ":PRMSL:mean sea level",
  factor: 1e-2,
};
