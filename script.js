// Global State
let nfts = [];
const MAX_NFTS = 1000;
const CONCURRENCY_LIMIT = 5;

// DOM Elements
const apiKeyInput = document.getElementById('apiKey');
const contractInput = document.getElementById('contractAddress');
const loadBtn = document.getElementById('loadBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const gallery = document.getElementById('gallery');
const detailsGrid = document.getElementById('detailsGrid');

const loadCountEl = document.getElementById('loadCount');
const metaCountEl = document.getElementById('metaCount');
const imgCountEl = document.getElementById('imgCount');
const failCountEl = document.getElementById('failCount');

// Helper: Normalize IPFS and HTTP Image URLs
function resolveImageUrl(url) {
  if (!url) return '';
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }
  return url;
}

// Helper: Detect file extension from media type or URL
function getExtensionFromUrl(url) {
  if (!url) return 'png';
  const cleanUrl = url.split('?')[0].split('#')[0];
  const extMatch = cleanUrl.match(/\.(png|jpg|jpeg|webp|gif|svg)$/i);
  return extMatch ? extMatch[1].toLowerCase() : 'png';
}

// Step 1: Fetch all NFTs from Alchemy with pagination
async function fetchNFTs() {
  const apiKey = apiKeyInput.value.trim();
  const contractAddress = contractInput.value.trim();

  if (!apiKey) {
    alert('Please enter your Alchemy API Key.');
    return;
  }

  // Reset UI State
  nfts = [];
  gallery.innerHTML = '';
  loadBtn.disabled = true;
  downloadBtn.disabled = true;
  detailsGrid.style.display = 'none';
  statusBadge.textContent = 'Loading';
  progressBar.style.width = '0%';

  let pageKey = null;
  let totalLoaded = 0;

  try {
    do {
      let endpoint = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}/getNFTsForCollection?contractAddress=${contractAddress}&withMetadata=true`;
      if (pageKey) {
        endpoint += `&startToken=${pageKey}`;
      }

      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      const fetchedNfts = data.nfts || [];

      if (fetchedNfts.length === 0) break;

      for (const item of fetchedNfts) {
        if (nfts.length >= MAX_NFTS) break;

        // Parse token ID (handle hex or decimal strings)
        let tokenId = item.id ? item.id.tokenId : null;
        if (tokenId && tokenId.startsWith('0x')) {
          tokenId = parseInt(tokenId, 16).toString();
        }

        const rawImageUrl = item.media?.[0]?.gateway || item.media?.[0]?.raw || item.metadata?.image || '';
        const resolvedUrl = resolveImageUrl(rawImageUrl);

        const nftObj = {
          tokenId: tokenId || `unknown-${nfts.length + 1}`,
          title: item.title || item.metadata?.name || `NFT #${tokenId}`,
          metadata: item,
          imageUrl: resolvedUrl
        };

        nfts.push(nftObj);
        renderNFTCard(nftObj);
      }

      totalLoaded = nfts.length;
      statusText.textContent = `Loading NFTs... Loaded: ${totalLoaded} / ${MAX_NFTS}`;
      loadCountEl.textContent = `${totalLoaded} / ${MAX_NFTS}`;
      progressBar.style.width = `${(totalLoaded / MAX_NFTS) * 100}%`;

      pageKey = data.nextToken || null;

    } while (pageKey && nfts.length < MAX_NFTS);

    statusBadge.textContent = 'Loaded';
    statusText.textContent = `Completed loading ${nfts.length} NFTs. Ready to download ZIP.`;
    if (nfts.length > 0) {
      downloadBtn.disabled = false;
    }
  } catch (error) {
    statusBadge.textContent = 'Error';
    statusText.textContent = `Error loading NFTs: ${error.message}`;
    console.error(error);
  } finally {
    loadBtn.disabled = false;
  }
}

// Render individual NFT card into the gallery
function renderNFTCard(nft) {
  const card = document.createElement('div');
  card.className = 'nft-card';

  const imgContainer = document.createElement('div');
  imgContainer.className = 'nft-image-container';

  if (nft.imageUrl) {
    const img = document.createElement('img');
    img.src = nft.imageUrl;
    img.alt = nft.title;
    img.loading = 'lazy';
    img.onerror = () => {
      imgContainer.innerHTML = `<span class="nft-image-fallback">Image Unavailable</span>`;
    };
    imgContainer.appendChild(img);
  } else {
    imgContainer.innerHTML = `<span class="nft-image-fallback">No Image URL</span>`;
  }

  const info = document.createElement('div');
  info.className = 'nft-info';

  const title = document.createElement('div');
  title.className = 'nft-title';
  title.textContent = nft.title;

  const id = document.createElement('div');
  id.className = 'nft-id';
  id.textContent = `ID: ${nft.tokenId}`;

  info.appendChild(title);
  info.appendChild(id);
  card.appendChild(imgContainer);
  card.appendChild(info);

  gallery.appendChild(card);
}

// Step 2: Download all images with concurrency control and build ZIP archive
async function downloadCollectionZip() {
  if (nfts.length === 0) return;

  downloadBtn.disabled = true;
  loadBtn.disabled = true;
  detailsGrid.style.display = 'grid';
  statusBadge.textContent = 'Preparing';

  const zip = new JSZip();
  const imagesFolder = zip.folder("images");
  const metadataFolder = zip.folder("metadata");

  let completedImages = 0;
  let completedMetadata = 0;
  let failedImages = 0;
  const total = nfts.length;

  metaCountEl.textContent = `0 / ${total}`;
  imgCountEl.textContent = `0 / ${total}`;
  failCountEl.textContent = `0`;
  progressBar.style.width = '0%';

  // 1. Write metadata JSON files directly
  statusText.textContent = 'Preparing Metadata...';
  for (const nft of nfts) {
    metadataFolder.file(`${nft.tokenId}.json`, JSON.stringify(nft.metadata, null, 2));
    completedMetadata++;
    metaCountEl.textContent = `${completedMetadata} / ${total}`;
  }

  // 2. Queue and process images concurrently
  statusText.textContent = 'Downloading Images...';

  async function fetchAndStoreImage(nft) {
    if (!nft.imageUrl) {
      failedImages++;
      failCountEl.textContent = failedImages;
      return;
    }

    try {
      const response = await fetch(nft.imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const blob = await response.blob();
      const ext = getExtensionFromUrl(nft.imageUrl);
      imagesFolder.file(`${nft.tokenId}.${ext}`, blob);

    } catch (err) {
      console.warn(`Failed image download for token ${nft.tokenId}:`, err);
      failedImages++;
      failCountEl.textContent = failedImages;
    } finally {
      completedImages++;
      imgCountEl.textContent = `${completedImages} / ${total}`;
      const progressPercent = Math.floor((completedImages / total) * 100);
      progressBar.style.width = `${progressPercent}%`;
      statusText.textContent = `Downloading... Progress: ${progressPercent}%`;
    }
  }

  // Concurrency pool execution (5 at a time)
  const pool = [];
  for (const nft of nfts) {
    const promise = fetchAndStoreImage(nft).then(() => {
      pool.splice(pool.indexOf(promise), 1);
    });
    pool.push(promise);

    if (pool.length >= CONCURRENCY_LIMIT) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);

  // 3. Compress ZIP and trigger download
  statusBadge.textContent = 'Compressing';
  statusText.textContent = 'Creating ZIP... Progress: 100%';

  try {
    const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
      statusText.textContent = `Creating ZIP... ${Math.floor(metadata.percent)}%`;
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = 'NFT-Collection.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    statusBadge.textContent = 'Complete';
    statusText.textContent = 'Download Ready! ZIP generated successfully.';
  } catch (err) {
    statusBadge.textContent = 'Error';
    statusText.textContent = `Failed to generate ZIP file: ${err.message}`;
    console.error(err);
  } finally {
    downloadBtn.disabled = false;
    loadBtn.disabled = false;
  }
}

// Event Listeners
loadBtn.addEventListener('click', fetchNFTs);
downloadBtn.addEventListener('click', downloadCollectionZip);
