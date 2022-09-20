set -xeu

wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O ~/miniconda.sh && \
    /bin/bash ~/miniconda.sh -b -p /opt/conda && /opt/conda/bin/conda install -c conda-forge cdo \
    &&  /opt/conda/bin/conda clean -afy
