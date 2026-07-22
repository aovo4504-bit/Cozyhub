/**
 * PRODUCTION ARCHITECTURE
 * JavaScript ES2025 (Modules)
 */

const API_ENDPOINT = '/api/proxy';

/**
 * Lớp Quản lý Giao tiếp Mạng (Có AbortController, Timeout, Retry)
 */
class APIService {
    static async request(command, payload = {}, retries = 2) {
        let lastError;
        
        for (let i = 0; i < retries; i++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000); // Timeout 12s

            try {
                const response = await fetch(API_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command, ...payload }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                const data = await response.json();
                
                if (data.status === 'error') {
                    throw new Error(data.message || 'Lỗi từ API Đối tác');
                }
                
                return data;

            } catch (error) {
                clearTimeout(timeoutId);
                lastError = error;
                console.warn(`Request failed (Attempt ${i + 1}/${retries}):`, error.message);
                
                // Nếu lỗi do người dùng (Ví dụ sai format), không cần retry
                if (error.message && error.message.includes('yêu cầu request_id')) {
                    throw error;
                }
                // Nghỉ 1s trước khi retry
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        throw new Error(lastError.name === 'AbortError' ? 'Mạng yếu, API phản hồi quá lâu!' : lastError.message);
    }
}

/**
 * Lớp Quản lý Giao diện người dùng (Toast, Loading, Modals)
 */
class UIManager {
    static showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icon = type === 'success' ? '✅' : '❌';
        toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        
        container.appendChild(toast);
        
        requestAnimationFrame(() => toast.classList.add('show'));
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    }

    static toggleBtnLoading(btn, isLoading) {
        if (isLoading) {
            btn.classList.add('loading');
            btn.disabled = true;
        } else {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }

    static formatCurrency(amount) {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
    }
}

/**
 * Lớp Điều phối Ứng dụng chính
 */
class AppCore {
    constructor() {
        // DOM Elements
        this.txtBalance = document.getElementById('txt-balance');
        this.btnRefresh = document.getElementById('btn-refresh-balance');
        this.formStatus = document.getElementById('form-check-status');
        this.btnCheck = document.getElementById('btn-check');
        this.statusResult = document.getElementById('status-result');
        this.productGrid = document.getElementById('product-grid');
        this.serviceCount = document.getElementById('service-count');
        
        // Modal Elements
        this.modal = document.getElementById('modal-topup');
        this.btnCloseModal = document.getElementById('btn-close-modal');
        this.denominationsGrid = document.getElementById('modal-denominations');
        this.btnSubmitTopup = document.getElementById('btn-submit-topup');
        
        // State
        this.products = [];
        this.selectedProduct = null;
        this.selectedDenomination = null;

        this.init();
    }

    async init() {
        this.bindEvents();
        await Promise.all([this.loadBalance(), this.loadProducts()]);
    }

    bindEvents() {
        // Cập nhật số dư
        this.btnRefresh.addEventListener('click', () => {
            this.txtBalance.classList.add('skeleton-text');
            this.txtBalance.textContent = '---------';
            this.loadBalance();
        });

        // Kiểm tra trạng thái đơn
        this.formStatus.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reqId = document.getElementById('input-request-id').value.trim();
            if (!reqId) return UIManager.showToast('Vui lòng nhập Request ID', 'error');

            UIManager.toggleBtnLoading(this.btnCheck, true);
            this.statusResult.classList.add('hidden');

            try {
                const res = await APIService.request('getstatus', { request_id: reqId });
                this.statusResult.innerHTML = JSON.stringify(res.data, null, 2);
                this.statusResult.classList.remove('hidden');
                UIManager.showToast('Lấy trạng thái thành công', 'success');
            } catch (error) {
                UIManager.showToast(error.message, 'error');
            } finally {
                UIManager.toggleBtnLoading(this.btnCheck, false);
            }
        });

        // Đóng Modal
        this.btnCloseModal.addEventListener('click', () => this.closeModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });

        // Xử lý nút Nạp thẻ (Mô phỏng gọi lệnh charging)
        this.btnSubmitTopup.addEventListener('click', () => {
            const acc = document.getElementById('topup-account').value.trim();
            if(!acc) return UIManager.showToast('Vui lòng nhập tài khoản/SĐT', 'error');
            if(!this.selectedDenomination) return UIManager.showToast('Vui lòng chọn mệnh giá', 'error');

            UIManager.toggleBtnLoading(this.btnSubmitTopup, true);
            // Giả lập xử lý nạp vì tài liệu API chưa cung cấp lệnh "charging" cụ thể
            setTimeout(() => {
                UIManager.toggleBtnLoading(this.btnSubmitTopup, false);
                UIManager.showToast(`Yêu cầu nạp ${UIManager.formatCurrency(this.selectedDenomination.value)} thành công!`, 'success');
                this.closeModal();
            }, 1500);
        });
    }

    async loadBalance() {
        try {
            const res = await APIService.request('getbalance');
            if (res && res.data && res.data.balance !== undefined) {
                this.txtBalance.classList.remove('skeleton-text');
                this.txtBalance.textContent = UIManager.formatCurrency(res.data.balance);
            }
        } catch (error) {
            this.txtBalance.classList.remove('skeleton-text');
            this.txtBalance.textContent = 'Lỗi tải';
            UIManager.showToast('Không thể lấy số dư', 'error');
        }
    }

    async loadProducts() {
        try {
            // Cơ chế Cache Session để giảm tải Server Vercel & API Đối tác
            const cached = sessionStorage.getItem('topup_products');
            let dataList = [];

            if (cached) {
                dataList = JSON.parse(cached);
            } else {
                const res = await APIService.request('productlist');
                dataList = res.data || [];
                sessionStorage.setItem('topup_products', JSON.stringify(dataList));
            }

            this.products = dataList;
            this.renderProductGrid();
            this.serviceCount.textContent = `${this.products.length} dịch vụ`;

        } catch (error) {
            this.productGrid.innerHTML = `<div class="status-result w-100" style="color:var(--danger)">Lỗi tải danh sách sản phẩm: ${error.message}</div>`;
            this.serviceCount.textContent = 'Lỗi';
        }
    }

    renderProductGrid() {
        this.productGrid.innerHTML = '';
        const fragment = document.createDocumentFragment();

        this.products.forEach((product, index) => {
            const card = document.createElement('div');
            card.className = 'product-card glass';
            card.style.animation = `fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards ${index * 0.05}s`;
            card.style.opacity = '0';
            
            // Xử lý lỗi ảnh 404 (Dùng fallback mặc định)
            const fallbackImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="%2394a3b8"><rect width="80" height="80" rx="40"/><text x="50%" y="50%" fill="white" font-size="24" text-anchor="middle" alignment-baseline="middle">🎮</text></svg>';

            card.innerHTML = `
                <img src="${product.image}" onerror="this.src='${fallbackImg}'" alt="${product.name}" class="product-img">
                <div>
                    <div class="product-name">${product.name}</div>
                    <div class="product-desc">Chiết khấu cực ưu đãi</div>
                </div>
            `;
            
            card.addEventListener('click', () => this.openModal(product));
            fragment.appendChild(card);
        });

        this.productGrid.appendChild(fragment);
    }

    openModal(product) {
        this.selectedProduct = product;
        this.selectedDenomination = null;
        this.btnSubmitTopup.disabled = true;

        document.getElementById('modal-title').textContent = product.name;
        document.getElementById('modal-icon').src = product.image;
        document.getElementById('topup-account').value = '';
        
        this.renderDenominations();
        
        this.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Chống cuộn nền
    }

    closeModal() {
        this.modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
    }

    renderDenominations() {
        this.denominationsGrid.innerHTML = '';
        const items = this.selectedProduct.items || [];
        const fragment = document.createDocumentFragment();

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'deno-btn';
            
            const discountTxt = item.discount > 0 ? `Chiết khấu ${item.discount}%` : 'Giá gốc';
            
            btn.innerHTML = `
                <span class="deno-price">${item.name}</span>
                <span class="deno-discount">${discountTxt}</span>
            `;

            btn.addEventListener('click', () => {
                // Xoá active cũ
                document.querySelectorAll('.deno-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedDenomination = item;
                this.btnSubmitTopup.disabled = false;
            });

            fragment.appendChild(btn);
        });

        this.denominationsGrid.appendChild(fragment);
    }
}

// Khởi chạy hệ thống
document.addEventListener('DOMContentLoaded', () => new AppCore());
